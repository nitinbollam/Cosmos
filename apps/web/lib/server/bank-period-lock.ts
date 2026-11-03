import { BankReconciliationStatus, type Prisma } from '@/generated/prisma-ledger'
import { addDays, isoDate } from './bank-statement-csv'
import { ApiError } from './session'

/**
 * Signed-off reconciliation periods freeze everything dated before their end: statement lines of
 * that bank account, and posted journal lines on its GL cash account. A change dated earlier would
 * silently alter balances that were already signed off, so it is refused until the period is reopened.
 */

type Db = Prisma.TransactionClient

/**
 * First write of every transaction that changes a bank account's statement lines, matches or
 * sign-off state. Updating the account row takes its row lock (Postgres) or the database write lock
 * (SQLite), so CSV and JSON imports, Plaid pages, matching, sign-off and reopen of one account run
 * one at a time, and each reads the lock boundary only after every earlier writer has committed.
 * Under Serializable isolation a writer that committed in between makes this update fail with a
 * serialization error, which callers report as 409.
 */
export async function lockBankAccount(db: Db, tenantId: string, bankAccountId: string) {
  const res = await db.bankAccount.updateMany({ where: { id: bankAccountId, tenantId }, data: { updatedAt: new Date() } })
  if (res.count === 0) throw new ApiError(404, 'Bank account not found')
}

/** Same lock for every bank account linked to one of these GL accounts (journal posting). */
export async function lockBankAccountsForGl(db: Db, tenantId: string, chartAccountIds: string[]) {
  if (!chartAccountIds.length) return
  await db.bankAccount.updateMany({ where: { tenantId, chartAccountId: { in: chartAccountIds } }, data: { updatedAt: new Date() } })
}

/** First instant that is still open for a bank account, or null when nothing is signed off. */
export async function bankLockBoundary(db: Db, tenantId: string, bankAccountId: string): Promise<Date | null> {
  const latest = await db.bankReconciliation.findFirst({
    where: { tenantId, bankAccountId, status: BankReconciliationStatus.SIGNED_OFF },
    orderBy: { periodEnd: 'desc' },
    select: { periodEnd: true },
  })
  return latest ? addDays(latest.periodEnd, 1) : null
}

export async function assertStatementDatesOpen(db: Db, tenantId: string, bankAccountId: string, dates: Date[]) {
  if (!dates.length) return
  const boundary = await bankLockBoundary(db, tenantId, bankAccountId)
  if (!boundary) return
  const locked = dates.filter((d) => d < boundary)
  if (locked.length) {
    throw new ApiError(
      409,
      `Statement period through ${isoDate(addDays(boundary, -1))} is signed off; reopen it before changing lines dated ${isoDate(locked[0]!)}`,
    )
  }
}

/** Refuses posting to a bank's GL account on a date inside (or before) a signed-off period. */
export async function assertLedgerPeriodOpen(db: Db, tenantId: string, accountIds: string[], postedAt: Date) {
  if (!accountIds.length) return
  const banks = await db.bankAccount.findMany({
    where: { tenantId, chartAccountId: { in: accountIds } },
    select: { id: true },
  })
  for (const bank of banks) {
    const boundary = await bankLockBoundary(db, tenantId, bank.id)
    if (boundary && postedAt < boundary) {
      throw new ApiError(
        409,
        `The bank reconciliation through ${isoDate(addDays(boundary, -1))} is signed off; reopen it before posting entries dated ${isoDate(postedAt)}`,
      )
    }
  }
}
