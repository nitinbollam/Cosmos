import { BankStatementSource, Prisma } from '@/generated/prisma-ledger'
import { assertStatementDatesOpen, lockBankAccount } from './bank-period-lock'
import { assertCashChartAccount } from './bank-reconciliation'
import { parseIsoDate, parseMoney, validateStatementRows, withDedupeKeys } from './bank-statement-csv'
import { ledgerDb } from './db'
import { ApiError } from './session'

/** Legacy JSON contract returns numbers; the sums behind them are Decimal. */
function toNum(v: Prisma.Decimal): number {
  return Number(v.toFixed(2)) // money-ok: legacy JSON contract returns numbers; the sum is Decimal
}

/** Plaid credentials and sync state stay on the server; API responses never include them. */
const SERVER_ONLY_BANK_FIELDS = { plaidAccessTokenEncrypted: true, plaidItemId: true, plaidSyncCursor: true } as const

export async function listBankAccounts(tenantId: string) {
  return ledgerDb.bankAccount.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: 'asc' },
    omit: SERVER_ONLY_BANK_FIELDS,
  })
}

export type BankAccountInput = {
  name?: unknown
  accountNumber?: unknown
  openingBalance?: unknown
  chartAccountId?: unknown
  currency?: unknown
  openingBalanceDate?: unknown
}

function optionalText(v: unknown, field: string, max: number): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  if (typeof v !== 'string' || v.trim().length > max) throw new ApiError(400, `${field} must be text of at most ${max} characters`)
  return v.trim() || null
}

async function assertGlAccountFree(tenantId: string, chartAccountId: string, exceptBankId?: string) {
  await assertCashChartAccount(ledgerDb, tenantId, chartAccountId)
  const other = await ledgerDb.bankAccount.findFirst({
    where: { tenantId, chartAccountId, ...(exceptBankId ? { id: { not: exceptBankId } } : {}) },
    select: { id: true },
  })
  if (other) throw new ApiError(409, 'That GL account is already linked to another bank account')
}

export async function createBankAccount(tenantId: string, dto: BankAccountInput) {
  const name = optionalText(dto.name, 'name', 120)
  if (!name) throw new ApiError(400, 'name is required')
  const balance = dto.openingBalance === undefined ? new Prisma.Decimal(0) : parseMoney(dto.openingBalance)
  if (!balance) throw new ApiError(400, 'openingBalance must be an amount with at most 2 decimals')
  const chartAccountId = optionalText(dto.chartAccountId, 'chartAccountId', 64)
  if (chartAccountId) await assertGlAccountFree(tenantId, chartAccountId)
  const currency = dto.currency === undefined ? 'USD' : String(dto.currency).trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'currency must be a 3-letter code')
  const openingBalanceDate = dto.openingBalanceDate === undefined || dto.openingBalanceDate === null ? null : parseIsoDate(dto.openingBalanceDate)
  if (dto.openingBalanceDate && !openingBalanceDate) throw new ApiError(400, 'openingBalanceDate must be YYYY-MM-DD')
  return ledgerDb.bankAccount.create({
    omit: SERVER_ONLY_BANK_FIELDS,
    data: {
      tenantId,
      name,
      accountNumber: optionalText(dto.accountNumber, 'accountNumber', 34) ?? null,
      currentBalance: balance,
      chartAccountId: chartAccountId ?? null,
      currency,
      openingBalanceDate,
    },
  })
}

/** Name, number, active flag and GL link. The GL link and opening date are frozen once reconciliations exist. */
export async function updateBankAccount(tenantId: string, id: string, dto: BankAccountInput, actorUserId: string) {
  const acct = await ledgerDb.bankAccount.findFirst({ where: { id, tenantId } })
  if (!acct) throw new ApiError(404, 'Bank account not found')
  const data: Prisma.BankAccountUpdateInput = {}
  const name = optionalText(dto.name, 'name', 120)
  if (name === null) throw new ApiError(400, 'name cannot be empty')
  if (name) data.name = name
  const accountNumber = optionalText(dto.accountNumber, 'accountNumber', 34)
  if (accountNumber !== undefined) data.accountNumber = accountNumber
  const touchesBookSide = dto.chartAccountId !== undefined || dto.openingBalanceDate !== undefined
  if (touchesBookSide) {
    const recons = await ledgerDb.bankReconciliation.count({ where: { tenantId, bankAccountId: id } })
    if (recons > 0) throw new ApiError(409, 'The GL link and opening date cannot change once reconciliations exist')
  }
  if (dto.chartAccountId !== undefined) {
    const chartAccountId = optionalText(dto.chartAccountId, 'chartAccountId', 64)
    if (chartAccountId) await assertGlAccountFree(tenantId, chartAccountId, id)
    data.chartAccountId = chartAccountId
  }
  if (dto.openingBalanceDate !== undefined) {
    const d = dto.openingBalanceDate === null ? null : parseIsoDate(dto.openingBalanceDate)
    if (dto.openingBalanceDate !== null && !d) throw new ApiError(400, 'openingBalanceDate must be YYYY-MM-DD')
    data.openingBalanceDate = d
  }
  if (!Object.keys(data).length) throw new ApiError(400, 'Nothing to update')
  return ledgerDb.$transaction(async (tx) => {
    const updated = await tx.bankAccount.update({ where: { id, tenantId }, data, omit: SERVER_ONLY_BANK_FIELDS })
    await tx.bankReconciliationEvent.create({
      data: {
        tenantId,
        bankAccountId: id,
        action: 'bank_account.updated',
        userId: actorUserId,
        metadata: {
          before: { name: acct.name, chartAccountId: acct.chartAccountId, openingBalanceDate: acct.openingBalanceDate?.toISOString() ?? null },
          after: { name: updated.name, chartAccountId: updated.chartAccountId, openingBalanceDate: updated.openingBalanceDate?.toISOString() ?? null },
        },
      },
    })
    return updated
  })
}

/**
 * JSON statement import (API clients). Rows are validated first (nothing is stored if any row is bad),
 * rows already on the account are skipped by dedupe key, and signed-off periods are refused. The
 * transaction locks the bank account before checking the lock boundary, so a concurrent sign-off
 * either sees these lines or makes this import fail with 409.
 */
export async function importStatementLines(
  tenantId: string,
  bankAccountId: string,
  lines: unknown,
  actorUserId?: string,
) {
  if (!Array.isArray(lines)) throw new ApiError(400, 'lines must be an array')
  const acct = await ledgerDb.bankAccount.findFirst({ where: { id: bankAccountId, tenantId } })
  if (!acct) throw new ApiError(404, 'Bank account not found')

  const { lines: valid, errors } = validateStatementRows(
    lines.map((l, i) => {
      const row = (l ?? {}) as Record<string, unknown>
      return { row: i + 1, postedAt: row.postedAt, description: row.description, amount: row.amount, reference: row.reference }
    }),
  )
  if (errors.length) throw new ApiError(400, `${errors.length} line(s) failed validation; nothing was imported`, undefined, errors)

  const keyed = withDedupeKeys(bankAccountId, valid)
  try {
    return await ledgerDb.$transaction(
      async (tx) => {
        await lockBankAccount(tx, tenantId, bankAccountId)
        await assertStatementDatesOpen(tx, tenantId, bankAccountId, keyed.map((l) => l.postedAt))
        const existing = await tx.bankStatementLine.findMany({
          where: { tenantId, bankAccountId, dedupeKey: { in: keyed.map((l) => l.dedupeKey) } },
          select: { dedupeKey: true },
        })
        const known = new Set(existing.map((e) => e.dedupeKey))
        const created = []
        for (const l of keyed) {
          if (known.has(l.dedupeKey)) continue
          created.push(
            await tx.bankStatementLine.create({
              data: {
                tenantId,
                bankAccountId,
                postedAt: l.postedAt,
                description: l.description,
                amount: l.amount,
                reference: l.reference,
                dedupeKey: l.dedupeKey,
                source: BankStatementSource.API,
              },
            }),
          )
        }
        const skipped = keyed.length - created.length
        await tx.bankReconciliationEvent.create({
          data: {
            tenantId,
            bankAccountId,
            action: skipped ? 'bank_statement.duplicate_skipped' : 'bank_statement.imported',
            userId: actorUserId ?? null,
            metadata: { source: 'API', rows: keyed.length, imported: created.length, skippedDuplicates: skipped },
          },
        })
        return created
      },
      { maxWait: 10_000, timeout: 30_000 },
    )
  } catch (e) {
    // Duplicate key or write conflict from a concurrent import of the same rows: someone else won.
    if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(e.code)) {
      throw new ApiError(409, 'Another import to this bank account happened at the same time; reload and retry')
    }
    throw e
  }
}

export type StatementLineFilterOpts = {
  bankAccountId?: string
  reconciled?: boolean
  type?: 'DEBIT' | 'CREDIT' | 'ALL'
  startDate?: string
  endDate?: string
}

/** A line actively matched in a bank reconciliation. */
const ACTIVELY_MATCHED: Prisma.BankStatementLineWhereInput = { matchItems: { some: { activeStatementLineId: { not: null } } } }
/** Neither reconciled by the retired line-only workflow nor actively matched. */
const UNRECONCILED: Prisma.BankStatementLineWhereInput = {
  reconciled: false,
  matchItems: { none: { activeStatementLineId: { not: null } } },
}

/** `reconciled` in responses means reconciled by either workflow (retired flag, or an active match). */
export async function listStatementLines(tenantId: string, opts?: StatementLineFilterOpts) {
  const where: Prisma.BankStatementLineWhereInput = { tenantId }

  if (opts?.bankAccountId) where.bankAccountId = opts.bankAccountId
  if (opts?.reconciled === false) Object.assign(where, UNRECONCILED)
  if (opts?.reconciled === true) where.OR = [{ reconciled: true }, ACTIVELY_MATCHED]

  if (opts?.startDate || opts?.endDate) {
    where.postedAt = {}
    if (opts.startDate) where.postedAt.gte = new Date(opts.startDate)
    if (opts.endDate) where.postedAt.lte = new Date(`${opts.endDate}T23:59:59.999Z`)
  }

  if (opts?.type === 'DEBIT') {
    where.amount = { gt: 0 }
  } else if (opts?.type === 'CREDIT') {
    where.amount = { lt: 0 }
  }

  const rows = await ledgerDb.bankStatementLine.findMany({
    where,
    include: {
      bankAccount: { select: { id: true, name: true } },
      matchItems: { where: { activeStatementLineId: { not: null } }, select: { id: true } },
    },
    orderBy: { postedAt: 'desc' },
    take: 300,
  })
  return rows.map(({ matchItems, ...line }) => ({ ...line, reconciled: line.reconciled || matchItems.length > 0 }))
}

export async function listUnreconciledLines(tenantId: string, bankAccountId?: string) {
  return listStatementLines(tenantId, { bankAccountId, reconciled: false })
}

/**
 * Deprecated: flipping a line to "reconciled" without a book item bypassed matching, sign-off and the
 * period lock (and could double-count the balance under concurrency, defect D2). Use
 * /bank-reconciliations/:id/matches instead.
 */
export async function reconcileStatementLine(_tenantId: string, _lineId: string): Promise<never> {
  throw new ApiError(410, 'Line-only reconcile was retired; match the line in a bank reconciliation (/bank-reconciliations)')
}

/**
 * Tile totals for the legacy Bank recon tab. Sums are Decimal over every line in range (no row cap,
 * defect D8), and the opening balance is computed per account from that account's own lines (D1).
 *
 * Definitions (see bank-reconciliation-implementation-decisions.md §13):
 * - BankAccount.currentBalance is the opening balance entered when the account was created, plus the
 *   lines reconciled by the retired line-only workflow (the only code that ever moved it; it now
 *   returns 410). Matching in a bank reconciliation never changes it.
 * - Account opening balance (this tile) = currentBalance − net of those retired-workflow lines in
 *   range, i.e. the entered opening balance for an account that never used the retired workflow.
 * - Statement opening/closing balances, book balance and adjusted balances belong to one statement
 *   period and live only in the bank reconciliation (bank-reconciliation.ts).
 */
export async function getReconciliationSummary(tenantId: string, opts?: { startDate?: string; endDate?: string }) {
  const postedAt: Prisma.DateTimeFilter = {}
  if (opts?.startDate) postedAt.gte = new Date(opts.startDate)
  if (opts?.endDate) postedAt.lte = new Date(`${opts.endDate}T23:59:59.999Z`)
  const [accounts, unreconciled, lines] = await Promise.all([
    ledgerDb.bankAccount.findMany({ where: { tenantId, isActive: true }, omit: SERVER_ONLY_BANK_FIELDS }),
    ledgerDb.bankStatementLine.count({ where: { tenantId, ...UNRECONCILED, bankAccount: { isActive: true } } }),
    ledgerDb.bankStatementLine.findMany({
      where: { tenantId, bankAccount: { isActive: true }, ...(opts?.startDate || opts?.endDate ? { postedAt } : {}) },
      select: { bankAccountId: true, amount: true, reconciled: true },
    }),
  ])

  const zero = new Prisma.Decimal(0)
  let totalDebits = zero
  let totalCredits = zero
  const reconciledNet = new Map<string, Prisma.Decimal>()
  for (const line of lines) {
    const amt = new Prisma.Decimal(line.amount)
    if (amt.isPositive()) totalDebits = totalDebits.plus(amt)
    else totalCredits = totalCredits.plus(amt.abs())
    if (line.reconciled) reconciledNet.set(line.bankAccountId, (reconciledNet.get(line.bankAccountId) ?? zero).plus(amt))
  }

  let openingBalanceTotal = zero
  let closingBalanceTotal = zero
  for (const a of accounts) {
    const current = new Prisma.Decimal(a.currentBalance)
    closingBalanceTotal = closingBalanceTotal.plus(current)
    openingBalanceTotal = openingBalanceTotal.plus(current.minus(reconciledNet.get(a.id) ?? zero))
  }

  return {
    accounts: accounts.map((a) => ({
      ...a,
      currentBalance: toNum(new Prisma.Decimal(a.currentBalance)),
    })),
    unreconciledCount: unreconciled,
    openingBalanceTotal: toNum(openingBalanceTotal),
    closingBalanceTotal: toNum(closingBalanceTotal),
    totalDebits: toNum(totalDebits),
    totalCredits: toNum(totalCredits),
  }
}
