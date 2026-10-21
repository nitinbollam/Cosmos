import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Prisma } from '@/generated/prisma-purchasing'
import { ledgerDb, orderDb, purchasingDb, tenantDb } from './db'
import { ensurePostingAccounts } from './ledger-posting'
import { runPostingJobs } from './posting-outbox'
import { issueGiftCard, redeemGiftCard } from './gift-cards'
import { addExpenseLine, createExpenseReport, decideExpenseReport, markExpenseReportPaid, submitExpenseReport } from './expense-reports'
import { createBillFromPurchaseOrder } from './ap-bills'

const tenant = () => `t-${randomUUID()}`

async function journal(id: string) {
  const e = await ledgerDb.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { include: { account: true } } } })
  return {
    description: e.description,
    sourceType: e.sourceType,
    debit: e.lines.filter((l) => Number(l.debit) > 0).map((l) => [l.account.code, l.memo, Number(l.debit)]),
    credit: e.lines.filter((l) => Number(l.credit) > 0).map((l) => [l.account.code, l.memo, Number(l.credit)]),
  }
}

const jobs = (tenantId: string, kind: string) => orderDb.postingJob.findMany({ where: { tenantId, kind: kind as never } })

async function reportWithLine(tenantId: string, amount: number) {
  const report = await createExpenseReport(tenantId, `user-${randomUUID()}`)
  await addExpenseLine(tenantId, report.id, { category: 'Travel', amount, description: 'Taxi', incurredAt: new Date().toISOString() })
  return report
}

async function receivedPo(tenantId: string) {
  const supplier = await purchasingDb.supplier.create({ data: { tenantId, code: `S-${randomUUID().slice(0, 6)}`, name: 'Acme Supply' } })
  return purchasingDb.purchaseOrder.create({
    data: {
      tenantId,
      supplierId: supplier.id,
      number: `PO-${randomUUID().slice(0, 6)}`,
      status: 'PARTIALLY_RECEIVED',
      lines: {
        create: [
          { lineNo: 1, description: 'Widget', qtyOrdered: 10, qtyReceived: 4, unitCost: new Prisma.Decimal('12.50') },
          { lineNo: 2, description: 'Bolt', qtyOrdered: 5, qtyReceived: 0, unitCost: new Prisma.Decimal('3.00') },
        ],
      },
    },
  })
}

test('billing a received PO queues the inventory accrual, and the worker posts it and links it to the bill', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const po = await receivedPo(tenantId)
  const bill = await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })
  assert.equal(bill.journalEntryId, null, 'nothing is posted inline')
  const [job] = await jobs(tenantId, 'PO_RECEIPT_JOURNAL')
  assert.equal(job.sourceType, 'VendorBill')
  assert.equal(job.sourceId, bill.id)
  assert.equal((job.payload as { amount: string }).amount, '50')

  await runPostingJobs({ tenantId })
  const linked = await purchasingDb.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })
  assert.ok(linked.journalEntryId)
  assert.deepEqual(await journal(linked.journalEntryId!), {
    description: `PO receipt ${bill.id.slice(-8)} — inventory accrual`,
    sourceType: 'VendorBill',
    debit: [['1100', 'Inventory received', 50]],
    credit: [['2100', 'Accounts payable', 50]],
  })
})

test('gift card issue and redeem queue one job each, keyed by card transaction, and post the same lines as before', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const card = await issueGiftCard(tenantId, { amount: 75 })
  const spent = await redeemGiftCard(tenantId, card.code, { amount: 30, orderRef: 'ORD-1' })
  assert.deepEqual(spent, { amountApplied: 30, remainingBalance: 45 })
  assert.equal(await ledgerDb.journalEntry.count({ where: { tenantId } }), 0, 'nothing is posted inline')

  await runPostingJobs({ tenantId })
  const txns = await tenantDb.giftCardTransaction.findMany({ where: { giftCardId: card.id }, orderBy: { createdAt: 'asc' } })
  assert.equal(txns.length, 2)
  const [issue, redeem] = [txns.find((t) => t.type === 'ISSUE')!, txns.find((t) => t.type === 'REDEEM')!]
  assert.ok(issue.journalEntryId && redeem.journalEntryId, 'both card transactions get their journal id')
  assert.deepEqual(await journal(issue.journalEntryId!), {
    description: `Gift card issued ${card.id.slice(-8)}`,
    sourceType: 'GiftCardTransaction',
    debit: [['1000', 'Cash received for gift card', 75]],
    credit: [['2150', 'Gift card liability', 75]],
  })
  assert.deepEqual(await journal(redeem.journalEntryId!), {
    description: `Gift card redeemed ${card.id.slice(-8)}`,
    sourceType: 'GiftCardTransaction',
    debit: [['2150', 'Gift card liability reduction', 30]],
    credit: [['4000', 'Gift card revenue recognition', 30]],
  })
})

test('an expense report approved then paid posts two journals with separate source keys', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const report = await reportWithLine(tenantId, 40)
  const approved = await submitExpenseReport(tenantId, report.id)
  assert.equal(approved.status, 'APPROVED')
  await markExpenseReportPaid(tenantId, report.id)
  await runPostingJobs({ tenantId })

  const entries = await ledgerDb.journalEntry.findMany({ where: { tenantId, sourceType: 'ExpenseReport', sourceId: report.id } })
  assert.deepEqual(entries.map((e) => e.variant).sort(), ['approved', 'paid'])
  const after = await ledgerDb.expenseReport.findUniqueOrThrow({ where: { id: report.id } })
  const approval = entries.find((e) => e.variant === 'approved')!
  assert.equal(after.journalEntryId, approval.id, 'the report keeps its approval journal')
  assert.deepEqual(await journal(approval.id), {
    description: `Expense report approved ${report.id.slice(-8)}`,
    sourceType: 'ExpenseReport',
    debit: [['6100', 'Employee expense', 40]],
    credit: [['2160', 'Reimbursement payable', 40]],
  })
  assert.deepEqual(await journal(entries.find((e) => e.variant === 'paid')!.id), {
    description: `Expense reimbursement paid ${report.id.slice(-8)}`,
    sourceType: 'ExpenseReport',
    debit: [['2160', 'Clear reimbursement payable', 40]],
    credit: [['1000', 'Cash paid', 40]],
  })
})

test('two approvers deciding at once approve the report once and post one journal', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const report = await reportWithLine(tenantId, 900)
  assert.equal((await submitExpenseReport(tenantId, report.id)).status, 'PENDING_APPROVAL')

  const results = await Promise.allSettled([
    decideExpenseReport(tenantId, report.id, { approve: true, decidedBy: 'a' }),
    decideExpenseReport(tenantId, report.id, { approve: true, decidedBy: 'b' }),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
  assert.match(String(lost.reason?.message), /just changed|not pending approval/)

  await runPostingJobs({ tenantId })
  assert.equal((await jobs(tenantId, 'EXPENSE_APPROVAL_JOURNAL')).length, 1)
  assert.equal(await ledgerDb.journalEntry.count({ where: { tenantId, sourceType: 'ExpenseReport' } }), 1)
})

test('without a chart of accounts every action still succeeds and leaves a visible failed job', async () => {
  const tenantId = tenant()
  const card = await issueGiftCard(tenantId, { amount: 20 })
  await redeemGiftCard(tenantId, card.code, { amount: 5, orderRef: 'ORD-2' })
  const report = await reportWithLine(tenantId, 15)
  await submitExpenseReport(tenantId, report.id)
  await markExpenseReportPaid(tenantId, report.id)
  const po = await receivedPo(tenantId)
  await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })

  await runPostingJobs({ tenantId, now: new Date(Date.now() + 5_000) })
  const byKind = Object.fromEntries(
    (await orderDb.postingJob.findMany({ where: { tenantId } })).map((j) => [j.kind, { status: j.status, error: j.lastError ?? '' }]),
  )
  for (const kind of ['GIFT_CARD_ISSUE_JOURNAL', 'GIFT_CARD_REDEEM_JOURNAL', 'EXPENSE_PAID_JOURNAL', 'PO_RECEIPT_JOURNAL']) {
    assert.equal(byKind[kind]?.status, 'PENDING', kind)
    assert.match(byKind[kind].error, /LedgerNotConfiguredError/, kind)
  }
  // The approval journal creates its own two accounts, as it did when it posted inline.
  assert.equal(byKind.EXPENSE_APPROVAL_JOURNAL?.status, 'DONE')
})

test('expense, gift card and bill code no longer write to the ledger directly', () => {
  for (const f of ['expense-reports.ts', 'gift-cards.ts', 'ap-bills.ts']) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
    assert.ok(!/postPoReceiptJournal|postExpense(Approval|Paid)Journal|postGiftCard(Issue|Redeem)Journal/.test(src), `${f} still posts inline`)
  }
})
