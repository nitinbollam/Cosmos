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

export async function listUnreconciledLines(tenantId: string, bankAccountId?: string) {
  return ledgerDb.bankStatementLine.findMany({
    where: {
      tenantId,
      reconciled: false,
      ...(bankAccountId ? { bankAccountId } : {}),
    },
    include: { bankAccount: true },
    orderBy: { postedAt: 'desc' },
    take: 200,
  })
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

export async function getReconciliationSummary(tenantId: string) {
  const [accounts, unreconciled] = await Promise.all([
    ledgerDb.bankAccount.findMany({ where: { tenantId, isActive: true } }),
    ledgerDb.bankStatementLine.count({ where: { tenantId, reconciled: false } }),
  ])
  return {
    accounts: accounts.map((a) => ({
      ...a,
      currentBalance: toNum(a.currentBalance),
    })),
    unreconciledCount: unreconciled,
  }
}
