import { AccountType, Prisma } from '@/generated/prisma-ledger'
import { assertLedgerPeriodOpen, lockBankAccountsForGl } from './bank-period-lock'
import { addDays, parseIsoDate } from './bank-statement-csv'
import { ledgerDb, tenantDb } from './db'
import { periodRange } from './period-bounds'
import { ApiError } from './session'

function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n)
}

function assertJournalBalanced(lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[]): void {
  let deb = new Prisma.Decimal(0)
  let cred = new Prisma.Decimal(0)
  for (const l of lines) {
    if (l.debit.gt(0) && l.credit.gt(0)) {
      throw new ApiError(400, 'Line cannot have both debit and credit')
    }
    deb = deb.plus(l.debit)
    cred = cred.plus(l.credit)
  }
  if (!deb.equals(cred)) throw new ApiError(400, 'Journal entry must balance (debits = credits)')
}

export type JournalEntryListFilters = {
  fromIso?: string
  toIso?: string
  accountId?: string
  postedOnly?: boolean
}

export function listJournalEntries(tenantId: string, filters?: JournalEntryListFilters) {
  const where: Prisma.JournalEntryWhereInput = { tenantId }

  if (filters?.postedOnly !== undefined) {
    where.isPosted = filters.postedOnly
  }

  if (filters?.fromIso || filters?.toIso) {
    where.postedAt = {}
    if (filters.fromIso) where.postedAt.gte = new Date(filters.fromIso)
    if (filters.toIso) where.postedAt.lte = new Date(`${filters.toIso}T23:59:59.999Z`)
  }

  if (filters?.accountId) {
    where.lines = { some: { accountId: filters.accountId } }
  }

  return ledgerDb.journalEntry.findMany({
    where,
    include: { lines: { include: { account: true } } },
    orderBy: { postedAt: 'desc' },
  })
}

export async function getJournalEntry(tenantId: string, id: string) {
  const row = await ledgerDb.journalEntry.findFirst({
    where: { id, tenantId },
    include: { lines: { include: { account: true } } },
  })
  if (!row) throw new ApiError(404, 'Journal entry not found')
  return row
}

export type JournalLineInput = {
  accountId: string
  memo?: string
  debit: number
  credit: number
}

export type CreateJournalEntryInput = {
  description: string
  fiscalPeriodClosed?: boolean
  /** Optional YYYY-MM-DD accounting date (e.g. a bank-fee adjustment); defaults to now. */
  postedAt?: string
  lines: JournalLineInput[]
}

export async function createJournalDraft(tenantId: string, dto: CreateJournalEntryInput) {
  if (!dto.lines?.length || dto.lines.length < 2) {
    throw new ApiError(400, 'At least two lines required')
  }
  const decLines = dto.lines.map((l) => ({
    accountId: l.accountId,
    memo: l.memo,
    debit: toDecimal(l.debit),
    credit: toDecimal(l.credit),
  }))
  assertJournalBalanced(decLines)

  const accountIds = [...new Set(dto.lines.map((l) => l.accountId))]
  const accounts = await ledgerDb.chartAccount.findMany({
    where: { tenantId, id: { in: accountIds } },
  })
  if (accounts.length !== accountIds.length) {
    throw new ApiError(400, 'One or more accounts are invalid for this tenant')
  }
  let postedAt: Date | undefined
  if (dto.postedAt !== undefined) {
    const day = parseIsoDate(dto.postedAt)
    if (!day) throw new ApiError(400, 'postedAt must be a date in YYYY-MM-DD format')
    // Noon UTC is the same calendar date from UTC-11 to UTC+11, so the tenant-zone trial balance
    // (PLR-156) and the UTC-dated bank reconciliation both put the entry on the date entered.
    postedAt = addDays(day, 0.5)
    await assertLedgerPeriodOpen(ledgerDb, tenantId, accountIds, postedAt)
  }

  return ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: dto.description,
      fiscalPeriodClosed: dto.fiscalPeriodClosed ?? false,
      ...(postedAt ? { postedAt } : {}),
      isPosted: false,
      lines: {
        create: decLines.map((l) => ({
          accountId: l.accountId,
          memo: l.memo,
          debit: l.debit,
          credit: l.credit,
        })),
      },
    },
    include: { lines: { include: { account: true } } },
  })
}

export async function postJournalEntry(tenantId: string, id: string) {
  const entry = await getJournalEntry(tenantId, id)
  if (entry.isPosted) throw new ApiError(400, 'Already posted')
  assertJournalBalanced(entry.lines.map((l) => ({ debit: l.debit, credit: l.credit })))
  // A draft keeps its creation date, so posting it later can land inside a signed-off bank
  // reconciliation period; that would silently change a signed-off book balance.
  await ledgerDb.$transaction(
    async (tx) => {
      const accountIds = [...new Set(entry.lines.map((l) => l.accountId))]
      // Same per-account lock as sign-off, so a posting and a sign-off of that bank never interleave.
      await lockBankAccountsForGl(tx, tenantId, accountIds)
      await assertLedgerPeriodOpen(tx, tenantId, accountIds, entry.postedAt)
      const res = await tx.journalEntry.updateMany({ where: { id, tenantId, isPosted: false }, data: { isPosted: true } })
      if (res.count !== 1) throw new ApiError(400, 'Already posted')
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  )
  return getJournalEntry(tenantId, id)
}

export function listChartAccounts(tenantId: string) {
  return ledgerDb.chartAccount.findMany({
    where: { tenantId },
    orderBy: { code: 'asc' },
  })
}

export async function getChartAccount(tenantId: string, id: string) {
  const row = await ledgerDb.chartAccount.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Account not found')
  return row
}

export type CreateChartAccountInput = {
  code: string
  name: string
  type: AccountType
  isActive?: boolean
}

export async function createChartAccount(tenantId: string, dto: CreateChartAccountInput) {
  try {
    return await ledgerDb.chartAccount.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        type: dto.type,
        isActive: dto.isActive ?? true,
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ApiError(409, 'Account code already exists')
    }
    throw e
  }
}

export async function patchChartAccount(
  tenantId: string,
  id: string,
  dto: { name?: string; isActive?: boolean },
) {
  await getChartAccount(tenantId, id)
  return ledgerDb.chartAccount.update({
    where: { id },
    data: { name: dto.name, isActive: dto.isActive },
  })
}

export type TrialBalanceOptions = {
  year: number
  periodType?: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
  month?: number
  quarter?: number
}

export type TrialBalanceRow = {
  accountCode: string
  accountName: string
  type: string
  /** Exact sums rounded for display; use the *Exact strings when comparing or posting. */
  debits: number
  credits: number
  netBalance: number
  debitsExact: string
  creditsExact: string
  netBalanceExact: string
}

/**
 * Trial balance for a period in the TENANT's time zone (PLR-156). Totals are summed by the database
 * and added as exact decimals - no per-line floating point - and the period is a half-open UTC
 * interval so adjacent periods neither overlap nor leave gaps. A bare year means the whole year.
 */
export async function trialBalance(
  tenantId: string,
  year: number,
  monthOrOpts?: number | TrialBalanceOptions,
): Promise<TrialBalanceRow[]> {
  const org = await tenantDb.tenantOrganization.findUnique({
    where: { id: tenantId },
    select: { timeZone: true },
  })
  const tz = org?.timeZone ?? 'Etc/UTC'

  let range
  if (typeof monthOrOpts === 'object' && monthOrOpts !== null) {
    const y = monthOrOpts.year || year
    range = periodRange(tz, y, monthOrOpts.periodType ?? 'MONTHLY', {
      month: monthOrOpts.month,
      quarter: monthOrOpts.quarter,
    })
  } else if (typeof monthOrOpts === 'number') {
    range = periodRange(tz, year, 'MONTHLY', { month: monthOrOpts })
  } else {
    range = periodRange(tz, year, 'YEARLY')
  }

  const sums = await ledgerDb.journalLine.groupBy({
    by: ['accountId'],
    where: {
      entry: { tenantId, isPosted: true, postedAt: { gte: range.start, lt: range.endExclusive } },
    },
    _sum: { debit: true, credit: true },
  })
  if (sums.length === 0) return []

  const accounts = await ledgerDb.chartAccount.findMany({
    where: { tenantId, id: { in: sums.map((s) => s.accountId) } },
  })
  const byId = new Map(accounts.map((a) => [a.id, a]))

  return sums
    .flatMap((s) => {
      const a = byId.get(s.accountId)
      if (!a) return []
      const debits = s._sum.debit ?? new Prisma.Decimal(0)
      const credits = s._sum.credit ?? new Prisma.Decimal(0)
      const net = debits.minus(credits)
      return [
        {
          accountCode: a.code,
          accountName: a.name,
          type: a.type,
          debits: debits.toNumber(),
          credits: credits.toNumber(),
          netBalance: net.toNumber(),
          debitsExact: debits.toFixed(2),
          creditsExact: credits.toFixed(2),
          netBalanceExact: net.toFixed(2),
        },
      ]
    })
    .sort((x, y) => x.accountCode.localeCompare(y.accountCode))
}
