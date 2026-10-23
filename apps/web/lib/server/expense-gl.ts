import { ledgerDb } from './db'
import { createChartAccount } from './ledger'
import { AccountType } from '@/generated/prisma-ledger'

// Expense journals are posted by the posting outbox (EXPENSE_APPROVAL_JOURNAL / EXPENSE_PAID_JOURNAL).
const EMPLOYEE_EXPENSE_CODE = '6100'
const REIMBURSEMENT_PAYABLE_CODE = '2160'

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

/** The accounts an approved expense report posts to, created on first use. */
export async function ensureExpenseAccounts(tenantId: string) {
  const expense = await ensureAccount(tenantId, EMPLOYEE_EXPENSE_CODE, 'Employee Expenses', AccountType.EXPENSE)
  const payable = await ensureAccount(
    tenantId,
    REIMBURSEMENT_PAYABLE_CODE,
    'Employee Reimbursements Payable',
    AccountType.LIABILITY,
  )
  return { expense, payable }
}

/** Inventory Shrinkage (5100), created on first use so existing tenants need no setup. */
export async function ensureShrinkageAccount(tenantId: string) {
  return ensureAccount(tenantId, '5100', 'Inventory Shrinkage', AccountType.EXPENSE)
}
