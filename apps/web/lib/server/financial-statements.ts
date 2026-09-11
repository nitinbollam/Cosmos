import { AccountType, Prisma } from '@/generated/prisma-ledger'
import { ledgerDb } from './db'
import { ApiError } from './session'

type AccountAgg = {
  accountId: string
  code: string
  name: string
  type: AccountType
  debit: Prisma.Decimal
  credit: Prisma.Decimal
}

export type StatementAccountRow = {
  accountId: string
  code: string
  name: string
  amount: number
}

export type IncomeStatementResult = {
  fromIso: string
  toIso: string
  revenue: { total: number; byAccount: StatementAccountRow[] }
  expenses: { total: number; byAccount: StatementAccountRow[] }
  netIncome: number
}

export type BalanceSheetResult = {
  asOfIso: string
  assets: { total: number; byAccount: StatementAccountRow[] }
  liabilities: { total: number; byAccount: StatementAccountRow[] }
  equity: { total: number; byAccount: StatementAccountRow[]; retainedEarnings: number }
  balanced: boolean
}

function dec(n: Prisma.Decimal): number {
  return Number(n.toFixed(2))
}

function requireIso(value: string | null, label: string): string {
  if (!value?.trim()) throw new ApiError(400, `${label} is required`)
  return value.trim()
}

async function aggregatePostedLines(
  tenantId: string,
  opts: {
    accountTypes: AccountType[]
    fromIso?: string
    toIso?: string
    asOfIso?: string
  },
): Promise<AccountAgg[]> {
  const postedAt: Prisma.DateTimeFilter = {}
  if (opts.fromIso) postedAt.gte = new Date(opts.fromIso)
  if (opts.toIso) postedAt.lte = new Date(`${opts.toIso}T23:59:59.999Z`)
  if (opts.asOfIso) postedAt.lte = new Date(`${opts.asOfIso}T23:59:59.999Z`)

  const lines = await ledgerDb.journalLine.findMany({
    where: {
      account: { tenantId, type: { in: opts.accountTypes } },
      entry: {
        tenantId,
        isPosted: true,
        ...(Object.keys(postedAt).length ? { postedAt } : {}),
      },
    },
    include: { account: true },
  })

  const map = new Map<string, AccountAgg>()
  for (const line of lines) {
    const prev = map.get(line.accountId) ?? {
      accountId: line.accountId,
      code: line.account.code,
      name: line.account.name,
      type: line.account.type,
      debit: new Prisma.Decimal(0),
      credit: new Prisma.Decimal(0),
    }
    prev.debit = prev.debit.plus(line.debit)
    prev.credit = prev.credit.plus(line.credit)
    map.set(line.accountId, prev)
  }

  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code))
}

function revenueAmount(row: AccountAgg): Prisma.Decimal {
  return row.credit.minus(row.debit)
}

function expenseAmount(row: AccountAgg): Prisma.Decimal {
  return row.debit.minus(row.credit)
}

function assetAmount(row: AccountAgg): Prisma.Decimal {
  return row.debit.minus(row.credit)
}

function liabilityOrEquityAmount(row: AccountAgg): Prisma.Decimal {
  return row.credit.minus(row.debit)
}

function toRows(rows: AccountAgg[], amountFn: (row: AccountAgg) => Prisma.Decimal): StatementAccountRow[] {
  return rows
    .map((row) => ({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      amount: dec(amountFn(row)),
    }))
    .filter((row) => Math.abs(row.amount) >= 0.005)
}

/** Sum net activity for one account in a calendar month (for budget vs actual). */
export async function aggregatePostedLinesForMonth(
  tenantId: string,
  accountId: string,
  fiscalYear: number,
  month: number,
): Promise<number> {
  const fromIso = `${fiscalYear}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(fiscalYear, month, 0)).getUTCDate()
  const toIso = `${fiscalYear}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  const lines = await ledgerDb.journalLine.findMany({
    where: {
      accountId,
      entry: {
        tenantId,
        isPosted: true,
        postedAt: {
          gte: new Date(fromIso),
          lte: new Date(`${toIso}T23:59:59.999Z`),
        },
      },
    },
    include: { account: true },
  })

  let debit = new Prisma.Decimal(0)
  let credit = new Prisma.Decimal(0)
  for (const line of lines) {
    debit = debit.plus(line.debit)
    credit = credit.plus(line.credit)
  }

  const type = lines[0]?.account.type
  if (type === AccountType.REVENUE) return dec(credit.minus(debit))
  if (type === AccountType.EXPENSE) return dec(debit.minus(credit))
  if (type === AccountType.ASSET) return dec(debit.minus(credit))
  return dec(credit.minus(debit))
}

export async function getIncomeStatement(
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<IncomeStatementResult> {
  const from = requireIso(fromIso, 'fromIso')
  const to = requireIso(toIso, 'toIso')

  const [revenueRows, expenseRows] = await Promise.all([
    aggregatePostedLines(tenantId, {
      accountTypes: [AccountType.REVENUE],
      fromIso: from,
      toIso: to,
    }),
    aggregatePostedLines(tenantId, {
      accountTypes: [AccountType.EXPENSE],
      fromIso: from,
      toIso: to,
    }),
  ])

  const revenueByAccount = toRows(revenueRows, revenueAmount)
  const expensesByAccount = toRows(expenseRows, expenseAmount)

  const revenueTotal = revenueByAccount.reduce((sum, row) => sum + row.amount, 0)
  const expensesTotal = expensesByAccount.reduce((sum, row) => sum + row.amount, 0)

  return {
    fromIso: from,
    toIso: to,
    revenue: { total: revenueTotal, byAccount: revenueByAccount },
    expenses: { total: expensesTotal, byAccount: expensesByAccount },
    netIncome: revenueTotal - expensesTotal,
  }
}

export async function computeRetainedEarnings(tenantId: string, asOfIso: string): Promise<number> {
  const [revenueRows, expenseRows] = await Promise.all([
    aggregatePostedLines(tenantId, {
      accountTypes: [AccountType.REVENUE],
      asOfIso,
    }),
    aggregatePostedLines(tenantId, {
      accountTypes: [AccountType.EXPENSE],
      asOfIso,
    }),
  ])

  const revenueTotal = revenueRows.reduce((sum, row) => sum.plus(revenueAmount(row)), new Prisma.Decimal(0))
  const expenseTotal = expenseRows.reduce((sum, row) => sum.plus(expenseAmount(row)), new Prisma.Decimal(0))
  return dec(revenueTotal.minus(expenseTotal))
}

export async function getBalanceSheet(tenantId: string, asOfIso: string): Promise<BalanceSheetResult> {
  const asOf = requireIso(asOfIso, 'asOfIso')

  const [assetRows, liabilityRows, equityRows, retainedEarnings] = await Promise.all([
    aggregatePostedLines(tenantId, { accountTypes: [AccountType.ASSET], asOfIso: asOf }),
    aggregatePostedLines(tenantId, { accountTypes: [AccountType.LIABILITY], asOfIso: asOf }),
    aggregatePostedLines(tenantId, { accountTypes: [AccountType.EQUITY], asOfIso: asOf }),
    computeRetainedEarnings(tenantId, asOf),
  ])

  const assetsByAccount = toRows(assetRows, assetAmount)
  const liabilitiesByAccount = toRows(liabilityRows, liabilityOrEquityAmount)
  const equityByAccount = toRows(equityRows, liabilityOrEquityAmount)

  const assetsTotal = assetsByAccount.reduce((sum, row) => sum + row.amount, 0)
  const liabilitiesTotal = liabilitiesByAccount.reduce((sum, row) => sum + row.amount, 0)
  const equityAccountsTotal = equityByAccount.reduce((sum, row) => sum + row.amount, 0)
  const equityTotal = equityAccountsTotal + retainedEarnings

  const balanced = Math.abs(assetsTotal - (liabilitiesTotal + equityTotal)) <= 0.01

  return {
    asOfIso: asOf,
    assets: { total: assetsTotal, byAccount: assetsByAccount },
    liabilities: { total: liabilitiesTotal, byAccount: liabilitiesByAccount },
    equity: {
      total: equityTotal,
      byAccount: equityByAccount,
      retainedEarnings,
    },
    balanced,
  }
}
