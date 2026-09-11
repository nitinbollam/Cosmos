import { Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
import { ApiError } from './session'
import { aggregatePostedLinesForMonth } from './financial-statements'

export async function createBudget(tenantId: string, input: { name: string; fiscalYear: number }) {
  if (!input.name.trim()) throw new ApiError(400, 'name required')
  if (input.fiscalYear < 2000 || input.fiscalYear > 2100) throw new ApiError(400, 'Invalid fiscal year')
  return ledgerDb.budget.create({
    data: {
      tenantId,
      name: input.name.trim(),
      fiscalYear: input.fiscalYear,
    },
    include: { lines: true },
  })
}

export async function listBudgets(tenantId: string, fiscalYear?: number) {
  return ledgerDb.budget.findMany({
    where: { tenantId, ...(fiscalYear ? { fiscalYear } : {}) },
    include: { lines: true },
    orderBy: { fiscalYear: 'desc' },
  })
}

export async function getBudget(tenantId: string, budgetId: string) {
  const budget = await ledgerDb.budget.findFirst({
    where: { id: budgetId, tenantId },
    include: { lines: true },
  })
  if (!budget) throw new ApiError(404, 'Budget not found')
  return budget
}

export async function upsertBudgetLines(
  tenantId: string,
  budgetId: string,
  lines: Array<{ accountId: string; month: number; budgetedAmount: number }>,
) {
  await getBudget(tenantId, budgetId)
  if (!lines.length) throw new ApiError(400, 'lines required')

  await ledgerDb.$transaction(
    lines.map((line) => {
      if (line.month < 1 || line.month > 12) throw new ApiError(400, 'month must be 1-12')
      return ledgerDb.budgetLine.upsert({
        where: {
          budgetId_accountId_month: {
            budgetId,
            accountId: line.accountId,
            month: line.month,
          },
        },
        create: {
          budgetId,
          accountId: line.accountId,
          month: line.month,
          budgetedAmount: new Prisma.Decimal(line.budgetedAmount),
        },
        update: { budgetedAmount: new Prisma.Decimal(line.budgetedAmount) },
      })
    }),
  )
}

export async function getBudgetVsActual(tenantId: string, budgetId: string) {
  const budget = await getBudget(tenantId, budgetId)
  const accounts = await ledgerDb.chartAccount.findMany({ where: { tenantId, isActive: true } })
  const accountMap = new Map(accounts.map((a) => [a.id, a]))

  const rows: Array<{
    accountId: string
    code: string
    name: string
    month: number
    budgeted: number
    actual: number
    variance: number
  }> = []

  for (const line of budget.lines) {
    const acct = accountMap.get(line.accountId)
    if (!acct) continue
    const actual = await aggregatePostedLinesForMonth(tenantId, line.accountId, budget.fiscalYear, line.month)
    const budgeted = Number(line.budgetedAmount)
    rows.push({
      accountId: line.accountId,
      code: acct.code,
      name: acct.name,
      month: line.month,
      budgeted,
      actual,
      variance: budgeted - actual,
    })
  }

  return { budgetId, fiscalYear: budget.fiscalYear, rows }
}
