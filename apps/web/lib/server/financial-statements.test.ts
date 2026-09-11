import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { AccountType } from '@/generated/prisma-ledger'
import { createChartAccount, createJournalDraft, postJournalEntry } from './ledger'
import { getBalanceSheet, getIncomeStatement } from './financial-statements'

test('income statement computes net income from posted revenue and expense', async () => {
  const tenantId = `tenant-${randomUUID()}`

  const revenue = await createChartAccount(tenantId, {
    code: '4000',
    name: 'Sales Revenue',
    type: AccountType.REVENUE,
  })
  const expense = await createChartAccount(tenantId, {
    code: '5500',
    name: 'Depreciation Expense',
    type: AccountType.EXPENSE,
  })
  const cash = await createChartAccount(tenantId, {
    code: '1000',
    name: 'Cash',
    type: AccountType.ASSET,
  })

  const revenueEntry = await createJournalDraft(tenantId, {
    description: 'Revenue recognition',
    lines: [
      { accountId: cash.id, debit: 1000, credit: 0 },
      { accountId: revenue.id, debit: 0, credit: 1000 },
    ],
  })
  await postJournalEntry(tenantId, revenueEntry.id)

  const expenseEntry = await createJournalDraft(tenantId, {
    description: 'Depreciation expense',
    lines: [
      { accountId: expense.id, debit: 400, credit: 0 },
      { accountId: cash.id, debit: 0, credit: 400 },
    ],
  })
  await postJournalEntry(tenantId, expenseEntry.id)

  const statement = await getIncomeStatement(tenantId, '2026-01-01', '2026-12-31')
  assert.equal(statement.revenue.total, 1000)
  assert.equal(statement.expenses.total, 400)
  assert.equal(statement.netIncome, 600)
})

test('balance sheet balances with fixed-asset-style depreciation postings', async () => {
  const tenantId = `tenant-${randomUUID()}`

  const expense = await createChartAccount(tenantId, {
    code: '5500',
    name: 'Depreciation Expense',
    type: AccountType.EXPENSE,
  })
  const accum = await createChartAccount(tenantId, {
    code: '1550',
    name: 'Accumulated Depreciation',
    type: AccountType.ASSET,
  })

  const draft = await createJournalDraft(tenantId, {
    description: 'Monthly depreciation',
    lines: [
      { accountId: expense.id, debit: 400, credit: 0 },
      { accountId: accum.id, debit: 0, credit: 400 },
    ],
  })
  await postJournalEntry(tenantId, draft.id)

  const sheet = await getBalanceSheet(tenantId, '2026-12-31')
  assert.equal(sheet.balanced, true)
  assert.equal(sheet.assets.total, -400)
  assert.equal(sheet.equity.retainedEarnings, -400)
  assert.equal(sheet.liabilities.total + sheet.equity.total, sheet.assets.total)
})
