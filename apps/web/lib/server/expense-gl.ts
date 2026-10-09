import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
import { createChartAccount } from './ledger'
import { AccountType } from '@/generated/prisma-ledger'

const EMPLOYEE_EXPENSE_CODE = '6100'
const REIMBURSEMENT_PAYABLE_CODE = '2160'
const CASH_CODE = '1000'

async function accountByCode(tenantId: string, code: string) {
  return ledgerDb.chartAccount.findFirst({ where: { tenantId, code, isActive: true } })
}

async function ensureAccount(
  tenantId: string,
  code: string,
  name: string,
  type: AccountType,
) {
  const existing = await accountByCode(tenantId, code)
  if (existing) return existing
  try {
    return await createChartAccount(tenantId, { code, name, type })
  } catch {
    const retry = await accountByCode(tenantId, code)
    if (retry) return retry
    throw new Error(`Unable to ensure chart account ${code}`)
  }
}

export async function postExpenseApprovalJournal(tenantId: string, reportId: string, amount: number) {
  if (amount <= 0) return null
  const expense = await ensureAccount(tenantId, EMPLOYEE_EXPENSE_CODE, 'Employee Expenses', AccountType.EXPENSE)
  const payable = await ensureAccount(
    tenantId,
    REIMBURSEMENT_PAYABLE_CODE,
    'Employee Reimbursements Payable',
    AccountType.LIABILITY,
  )

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `Expense report approved ${reportId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: expense.id,
            memo: 'Employee expense',
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: payable.id,
            memo: 'Reimbursement payable',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
          },
        ],
      },
    },
  })
  return entry.id
}

export async function postExpensePaidJournal(tenantId: string, reportId: string, amount: number) {
  if (amount <= 0) return null
  const payable = await accountByCode(tenantId, REIMBURSEMENT_PAYABLE_CODE)
  const cash = await accountByCode(tenantId, CASH_CODE)
  if (!payable || !cash) return null

  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: `Expense reimbursement paid ${reportId.slice(-8)}`,
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          {
            accountId: payable.id,
            memo: 'Clear reimbursement payable',
            debit: new Prisma.Decimal(amount),
            credit: new Prisma.Decimal(0),
          },
          {
            accountId: cash.id,
            memo: 'Cash paid',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(amount),
          },
        ],
      },
    },
  })
  return entry.id
}
