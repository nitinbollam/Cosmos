import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'

/** Accounts that automated postings (invoices, COGS, credit memos) need in every tenant. */
export const POSTING_ACCOUNTS = [
  { code: '1000', name: 'Cash', type: 'ASSET' as const },
  { code: '1100', name: 'Inventory', type: 'ASSET' as const },
  { code: '1200', name: 'Accounts Receivable', type: 'ASSET' as const },
  { code: '2100', name: 'Accounts Payable', type: 'LIABILITY' as const },
  { code: '4000', name: 'Sales Revenue', type: 'REVENUE' as const },
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE' as const },
]

/**
 * The chart of accounts is missing (or has deactivated) an account an automated posting needs.
 * Retryable by design: once the account exists the queued job completes.
 */
export class LedgerNotConfiguredError extends Error {
  readonly missing: string[]
  constructor(tenantId: string, missing: string[]) {
    super(`Ledger not configured for tenant ${tenantId}: missing or inactive account(s) ${missing.join(', ')}`)
    this.name = 'LedgerNotConfiguredError'
    this.missing = missing
  }
}

export type JournalSource = { sourceType: string; sourceId: string; variant?: string }

export async function requireAccounts(tenantId: string, codes: string[]) {
  const rows = await ledgerDb.chartAccount.findMany({
    where: { tenantId, code: { in: codes }, isActive: true },
  })
  const byCode = new Map(rows.map((r) => [r.code, r]))
  const missing = codes.filter((c) => !byCode.has(c))
  if (missing.length) throw new LedgerNotConfiguredError(tenantId, missing)
  return byCode
}

export async function missingPostingAccounts(tenantId: string, codes = POSTING_ACCOUNTS.map((a) => a.code)) {
  const rows = await ledgerDb.chartAccount.findMany({
    where: { tenantId, code: { in: codes }, isActive: true },
    select: { code: true },
  })
  const have = new Set(rows.map((r) => r.code))
  return codes.filter((c) => !have.has(c))
}

/** Creates any missing posting accounts. Never touches or reactivates an existing account. */
export async function ensurePostingAccounts(tenantId: string) {
  for (const acct of POSTING_ACCOUNTS) {
    await ledgerDb.chartAccount.upsert({
      where: { tenantId_code: { tenantId, code: acct.code } },
      create: { tenantId, code: acct.code, name: acct.name, type: acct.type, isActive: true },
      update: {},
    })
  }
}

type Line = { accountId: string; memo: string; debit: Prisma.Decimal; credit: Prisma.Decimal }

/**
 * Creates a posted, balanced journal entry exactly once per (tenant, source, variant).
 * Replays return the existing entry id; the database unique key settles concurrent workers.
 */
export async function createJournalOnce(
  tenantId: string,
  source: JournalSource,
  description: string,
  lines: Line[],
): Promise<string> {
  const variant = source.variant ?? ''
  const key = { tenantId, sourceType: source.sourceType, sourceId: source.sourceId, variant }
  const existing = await ledgerDb.journalEntry.findFirst({ where: key, select: { id: true } })
  if (existing) return existing.id

  const debit = lines.reduce((s, l) => s.plus(l.debit), new Prisma.Decimal(0))
  const credit = lines.reduce((s, l) => s.plus(l.credit), new Prisma.Decimal(0))
  if (!debit.equals(credit)) throw new Error(`Unbalanced journal for ${source.sourceType}:${source.sourceId}`)

  try {
    const entry = await ledgerDb.journalEntry.create({
      data: { ...key, description, isPosted: true, postedAt: new Date(), lines: { create: lines } },
    })
    return entry.id
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await ledgerDb.journalEntry.findFirst({ where: key, select: { id: true } })
      if (winner) return winner.id
    }
    throw err
  }
}
