import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Prisma } from '@/generated/prisma-purchasing'
import { ledgerDb, orderDb, purchasingDb, tenantDb } from './db'
import { ensurePostingAccounts } from './ledger-posting'
import { postingDedupeKey, runPostingJobs } from './posting-outbox'
import { giftCardJob, requeueMissingSourcePostings } from './posting-sources'
import { updatePurchaseOrderLandedCosts } from './purchasing'
import { issueGiftCard, redeemGiftCard } from './gift-cards'
import { addExpenseLine, createExpenseReport, decideExpenseReport, markExpenseReportPaid, submitExpenseReport } from './expense-reports'
import { createBillFromPurchaseOrder } from './ap-bills'

const tenant = () => `t-${randomUUID()}`
/** Past the sweep's grace period, so changes made in the test count as settled. */
const later = () => new Date(Date.now() + 20 * 60_000)

/** Prisma delegates are plain properties on the client, so a test can swap one out and put it back. */
async function withPatched<T>(obj: object, key: string, replacement: unknown, fn: () => Promise<T>): Promise<T> {
  const o = obj as Record<string, unknown>
  const original = o[key]
  o[key] = replacement
  try {
    return await fn()
  } finally {
    o[key] = original
  }
}

/** Net inventory (1100) the ledger holds for a bill's receipts. */
async function inventoryPosted(tenantId: string, billId: string) {
  const lines = await ledgerDb.journalLine.findMany({
    where: { entry: { tenantId, sourceType: 'VendorBill', sourceId: billId }, account: { code: '1100' } },
  })
  return lines.reduce((n, l) => n + Number(l.debit) - Number(l.credit), 0)
}

/** Runs the worker until nothing is left to do now (a job that saw a concurrent change retries). */
async function drain(tenantId: string) {
  for (let i = 0; i < 5; i++) {
    const r = await runPostingJobs({ tenantId, now: new Date(Date.now() + i * 3_600_000) })
    if (r.claimed === 0) return
  }
}

const receiveMore = (poId: string, lineNo: number, qty: number) =>
  purchasingDb.purchaseOrderLine.updateMany({ where: { purchaseOrderId: poId, lineNo }, data: { qtyReceived: { increment: qty } } })

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

test('re-billing after more stock arrives posts the difference, and lowering landed charges reverses it', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const po = await receivedPo(tenantId)
  await purchasingDb.purchaseOrder.update({ where: { id: po.id }, data: { freightAmount: new Prisma.Decimal(28) } })
  const bill = await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })
  // 4 x 12.50 received of 140 ordered, so 50/140 of the 28 freight: 10.00.
  assert.equal(Number(bill.totalAmount), 60)
  await drain(tenantId)
  assert.equal(await inventoryPosted(tenantId, bill.id), 60)

  await receiveMore(po.id, 1, 2)
  const grown = await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })
  assert.equal(Number(grown.totalAmount), 90) // 75 + 15 freight
  await drain(tenantId)
  assert.equal(await inventoryPosted(tenantId, bill.id), 90)

  await updatePurchaseOrderLandedCosts(tenantId, po.id, { freightAmount: 0 })
  await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })
  await drain(tenantId)
  assert.equal(await inventoryPosted(tenantId, bill.id), 75)
  const reversal = await ledgerDb.journalEntry.findFirstOrThrow({ where: { tenantId, sourceId: bill.id, description: { contains: 'reversal' } } })
  assert.deepEqual((await journal(reversal.id)).debit, [['2100', 'Accounts payable reduction', 15]])

  // Re-billing with nothing new starts no revision and posts nothing.
  const jobsBefore = (await jobs(tenantId, 'PO_RECEIPT_JOURNAL')).length
  await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })
  assert.equal((await jobs(tenantId, 'PO_RECEIPT_JOURNAL')).length, jobsBefore)
  const linked = await purchasingDb.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })
  assert.ok(linked.journalEntryId, 'the bill keeps its first receipt journal')
})

test('two re-bills at once leave the ledger at the bill total', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const po = await receivedPo(tenantId)
  const bill = await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })
  await receiveMore(po.id, 2, 5)
  const results = await Promise.allSettled([
    createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id }),
    createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id }),
  ])
  for (const r of results) if (r.status === 'rejected') assert.match(String(r.reason?.message), /just re-billed/)
  await drain(tenantId)
  const final = await purchasingDb.vendorBill.findUniqueOrThrow({ where: { id: bill.id } })
  assert.equal(Number(final.totalAmount), 65)
  assert.equal(await inventoryPosted(tenantId, bill.id), 65)
})

test('a bill posted before the outbox is re-billed by the difference only', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const po = await receivedPo(tenantId)
  const bill = await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })
  // Make it look like the old code: a journal without a source key, linked to the bill, and no job.
  await orderDb.postingJob.deleteMany({ where: { tenantId } })
  const accounts = await ledgerDb.chartAccount.findMany({ where: { tenantId, code: { in: ['1100', '2100'] } } })
  const id = (c: string) => accounts.find((a) => a.code === c)!.id
  const legacy = await ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: 'PO receipt (old)',
      isPosted: true,
      postedAt: new Date(),
      lines: {
        create: [
          { accountId: id('1100'), debit: new Prisma.Decimal(50), credit: new Prisma.Decimal(0) },
          { accountId: id('2100'), debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(50) },
        ],
      },
    },
  })
  await purchasingDb.vendorBill.update({ where: { id: bill.id }, data: { journalEntryId: legacy.id } })

  await receiveMore(po.id, 1, 2)
  await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: po.id })
  assert.equal((await requeueMissingSourcePostings({ tenantId, now: later() })).requeued, 0)
  await drain(tenantId)
  const adjustments = await ledgerDb.journalEntry.findMany({ where: { tenantId, sourceType: 'VendorBill', sourceId: bill.id }, include: { lines: true } })
  assert.equal(adjustments.length, 1)
  assert.equal(adjustments[0].lines.reduce((n, l) => n + Number(l.debit), 0), 25)
})

test('a posting that could not be queued is re-queued by the sweep under the same key', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const failing = { upsert: async () => { throw new Error('injected: order database unreachable') } }
  const card = await withPatched(orderDb, 'postingJob', failing, () => issueGiftCard(tenantId, { amount: 40 }))
  assert.equal((await jobs(tenantId, 'GIFT_CARD_ISSUE_JOURNAL')).length, 0)

  assert.equal((await requeueMissingSourcePostings({ tenantId })).requeued, 0, 'too recent: the request may still be queuing it')
  assert.equal((await requeueMissingSourcePostings({ tenantId, now: later() })).requeued, 1)
  const [txn] = await tenantDb.giftCardTransaction.findMany({ where: { giftCardId: card.id } })
  const [job] = await jobs(tenantId, 'GIFT_CARD_ISSUE_JOURNAL')
  assert.equal(job.dedupeKey, postingDedupeKey(giftCardJob(tenantId, txn)))

  await runPostingJobs({ tenantId })
  assert.ok((await tenantDb.giftCardTransaction.findUniqueOrThrow({ where: { id: txn.id } })).journalEntryId)
  assert.equal((await requeueMissingSourcePostings({ tenantId, now: later() })).requeued, 0)
})

test('the sweep leaves failed jobs alone and never posts reports paid before paidAt existed', async () => {
  const tenantId = tenant()
  await issueGiftCard(tenantId, { amount: 10 }) // no chart of accounts: the job will fail
  await orderDb.postingJob.updateMany({ where: { tenantId }, data: { status: 'DEAD' } })

  const report = await reportWithLine(tenantId, 30)
  await submitExpenseReport(tenantId, report.id)
  await ledgerDb.expenseReport.update({ where: { id: report.id }, data: { status: 'PAID', paidAt: null } })

  const res = await requeueMissingSourcePostings({ tenantId, now: later() })
  assert.equal(res.requeued, 0)
  assert.equal((await jobs(tenantId, 'EXPENSE_PAID_JOURNAL')).length, 0)
})
