import { AccountType, Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
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

export function listJournalEntries(tenantId: string) {
  return ledgerDb.journalEntry.findMany({
    where: { tenantId },
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

  return ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: dto.description,
      fiscalPeriodClosed: dto.fiscalPeriodClosed ?? false,
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
  return ledgerDb.journalEntry.update({
    where: { id },
    data: { isPosted: true },
    include: { lines: { include: { account: true } } },
  })
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

export async function trialBalance(
  tenantId: string,
  year: number,
  monthOrOpts?: number | TrialBalanceOptions,
) {
  let start: Date
  let end: Date

  if (typeof monthOrOpts === 'object' && monthOrOpts !== null) {
    const opts = monthOrOpts
    const y = opts.year || year
    const pType = opts.periodType ?? 'MONTHLY'
    if (pType === 'YEARLY') {
      start = new Date(y, 0, 1)
      end = new Date(y, 11, 31, 23, 59, 59, 999)
    } else if (pType === 'QUARTERLY') {
      const q = Math.max(1, Math.min(4, opts.quarter ?? 1))
      const startMonth = (q - 1) * 3
      start = new Date(y, startMonth, 1)
      end = new Date(y, startMonth + 3, 0, 23, 59, 59, 999)
    } else {
      const m = Math.max(1, Math.min(12, opts.month ?? 1))
      start = new Date(y, m - 1, 1)
      end = new Date(y, m, 0, 23, 59, 59, 999)
    }
  } else {
    const m = typeof monthOrOpts === 'number' ? monthOrOpts : 1
    start = new Date(year, m - 1, 1)
    end = new Date(year, m, 0, 23, 59, 59, 999)
  }

  const entries = await ledgerDb.journalEntry.findMany({
    where: {
      tenantId,
      isPosted: true,
      postedAt: { gte: start, lte: end },
    },
    include: { lines: { include: { account: true } } },
  })

  const map = new Map<
    string,
    { accountCode: string; accountName: string; type: string; debits: number; credits: number }
  >()

  for (const e of entries) {
    for (const l of e.lines) {
      const a = l.account
      if (!map.has(a.id)) {
        map.set(a.id, {
          accountCode: a.code,
          accountName: a.name,
          type: a.type,
          debits: 0,
          credits: 0,
        })
      }
      const row = map.get(a.id)!
      row.debits += Number(l.debit)
      row.credits += Number(l.credit)
    }
  }

  return [...map.values()]
    .sort((x, y) => x.accountCode.localeCompare(y.accountCode))
    .map((r) => ({
      ...r,
      netBalance: r.debits - r.credits,
    }))
}
