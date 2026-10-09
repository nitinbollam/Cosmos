import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
import { ApiError } from './session'

function toNum(v: unknown): number {
  if (v == null) return 0
  return Number(v)
}

export async function listBankAccounts(tenantId: string) {
  return ledgerDb.bankAccount.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: 'asc' },
  })
}

export async function createBankAccount(
  tenantId: string,
  dto: { name: string; accountNumber?: string; openingBalance?: number },
) {
  const balance = dto.openingBalance ?? 0
  return ledgerDb.bankAccount.create({
    data: {
      tenantId,
      name: dto.name.trim(),
      accountNumber: dto.accountNumber?.trim(),
      currentBalance: new Prisma.Decimal(balance),
    },
  })
}

export async function importStatementLines(
  tenantId: string,
  bankAccountId: string,
  lines: Array<{ postedAt: string; description: string; amount: number; reference?: string }>,
) {
  const acct = await ledgerDb.bankAccount.findFirst({ where: { id: bankAccountId, tenantId } })
  if (!acct) throw new ApiError(404, 'Bank account not found')

  const created = await ledgerDb.$transaction(
    lines.map((line) =>
      ledgerDb.bankStatementLine.create({
        data: {
          tenantId,
          bankAccountId,
          postedAt: new Date(line.postedAt),
          description: line.description.trim(),
          amount: new Prisma.Decimal(line.amount),
          reference: line.reference?.trim(),
        },
      }),
    ),
  )
  return created
}

export type StatementLineFilterOpts = {
  bankAccountId?: string
  reconciled?: boolean
  type?: 'DEBIT' | 'CREDIT' | 'ALL'
  startDate?: string
  endDate?: string
}

export async function listStatementLines(tenantId: string, opts?: StatementLineFilterOpts) {
  const where: Prisma.BankStatementLineWhereInput = { tenantId }

  if (opts?.bankAccountId) where.bankAccountId = opts.bankAccountId
  if (typeof opts?.reconciled === 'boolean') where.reconciled = opts.reconciled

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

  return ledgerDb.bankStatementLine.findMany({
    where,
    include: { bankAccount: true },
    orderBy: { postedAt: 'desc' },
    take: 300,
  })
}

export async function listUnreconciledLines(tenantId: string, bankAccountId?: string) {
  return listStatementLines(tenantId, { bankAccountId, reconciled: false })
}

export async function reconcileStatementLine(tenantId: string, lineId: string) {
  const line = await ledgerDb.bankStatementLine.findFirst({
    where: { id: lineId, tenantId },
    include: { bankAccount: true },
  })
  if (!line) throw new ApiError(404, 'Statement line not found')
  if (line.reconciled) return line

  const amount = toNum(line.amount)
  const updated = await ledgerDb.$transaction(async (tx) => {
    const row = await tx.bankStatementLine.update({
      where: { id: lineId },
      data: { reconciled: true, reconciledAt: new Date() },
    })
    await tx.bankAccount.update({
      where: { id: line.bankAccountId },
      data: { currentBalance: { increment: new Prisma.Decimal(amount) } },
    })
    return row
  })
  return updated
}

export async function getReconciliationSummary(tenantId: string, opts?: { startDate?: string; endDate?: string }) {
  const [accounts, unreconciled, allLines] = await Promise.all([
    ledgerDb.bankAccount.findMany({ where: { tenantId, isActive: true } }),
    ledgerDb.bankStatementLine.count({ where: { tenantId, reconciled: false } }),
    listStatementLines(tenantId, { startDate: opts?.startDate, endDate: opts?.endDate }),
  ])

  let totalDebits = 0
  let totalCredits = 0

  for (const line of allLines) {
    const amt = toNum(line.amount)
    if (amt > 0) totalDebits += amt
    else totalCredits += Math.abs(amt)
  }

  const openingBalanceTotal = accounts.reduce((sum, a) => sum + toNum(a.currentBalance) - (totalDebits - totalCredits), 0)
  const closingBalanceTotal = accounts.reduce((sum, a) => sum + toNum(a.currentBalance), 0)

  return {
    accounts: accounts.map((a) => ({
      ...a,
      currentBalance: toNum(a.currentBalance),
    })),
    unreconciledCount: unreconciled,
    openingBalanceTotal,
    closingBalanceTotal,
    totalDebits,
    totalCredits,
  }
}
