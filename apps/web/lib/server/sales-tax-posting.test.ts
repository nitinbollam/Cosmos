import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { Prisma } from '@/generated/prisma-order'
import { ledgerDb, orderDb } from './db'
import { splitBaseAmounts } from './invoice-tax-split'
import { applyCreditMemo, issueInvoiceForOrder } from './invoices'
import { ensurePostingAccounts, requireSalesTaxPayable } from './ledger-posting'
import { postJob, runPostingJobs } from './posting-outbox'
import { getBalanceSheet, getIncomeStatement } from './financial-statements'

const tenant = () => `t-${randomUUID()}`

type Row = { code: string; debit: string; credit: string }

async function entryLines(tenantId: string, entryId: string): Promise<Row[]> {
  const e = await ledgerDb.journalEntry.findFirstOrThrow({
    where: { id: entryId, tenantId },
    include: { lines: { include: { account: true } } },
  })
  return e.lines
    .map((l) => ({ code: l.account.code, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2) }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

async function job(tenantId: string, kind: string, amount: string, taxAmount?: string, sourceId = randomUUID()) {
  return postJob({
    id: randomUUID(),
    tenantId,
    kind: kind as never,
    sourceType: kind === 'CREDIT_MEMO_JOURNAL' ? 'CreditMemo' : 'Invoice',
    sourceId,
    variant: '',
    payload: taxAmount ? { amount, taxAmount } : { amount },
  })
}

test('a $100 invoice with 7% tax posts AR 107, revenue 100, sales tax payable 7', async () => {
  const t = tenant()
  await ensurePostingAccounts(t)
  const id = await job(t, 'INVOICE_JOURNAL', '107.00', '7.00')
  assert.deepEqual(await entryLines(t, id), [
    { code: '1200', debit: '107.00', credit: '0.00' },
    { code: '2200', debit: '0.00', credit: '7.00' },
    { code: '4000', debit: '0.00', credit: '100.00' },
  ])
})

test('a zero-tax invoice posts two lines and no tax line', async () => {
  const t = tenant()
  await ensurePostingAccounts(t)
  const id = await job(t, 'INVOICE_JOURNAL', '100.00')
  assert.deepEqual(await entryLines(t, id), [
    { code: '1200', debit: '100.00', credit: '0.00' },
    { code: '4000', debit: '0.00', credit: '100.00' },
  ])
})

test('a full credit memo reverses revenue, tax and AR', async () => {
  const t = tenant()
  await ensurePostingAccounts(t)
  const id = await job(t, 'CREDIT_MEMO_JOURNAL', '107.00', '7.00')
  assert.deepEqual(await entryLines(t, id), [
    { code: '1200', debit: '0.00', credit: '107.00' },
    { code: '2200', debit: '7.00', credit: '0.00' },
    { code: '4000', debit: '100.00', credit: '0.00' },
  ])
})

test('a job queued before tax was split out still posts everything to revenue', async () => {
  const t = tenant()
  await ensurePostingAccounts(t)
  const id = await job(t, 'INVOICE_EXTENSION_JOURNAL', '53.50')
  assert.deepEqual(await entryLines(t, id), [
    { code: '1200', debit: '53.50', credit: '0.00' },
    { code: '4000', debit: '0.00', credit: '53.50' },
  ])
})

test('a tenant without account 2200 gets it created when the first taxed invoice posts', async () => {
  const t = tenant()
  await ledgerDb.chartAccount.createMany({
    data: [
      { tenantId: t, code: '1200', name: 'AR', type: 'ASSET', isActive: true },
      { tenantId: t, code: '4000', name: 'Revenue', type: 'REVENUE', isActive: true },
    ],
  })
  const id = await job(t, 'INVOICE_JOURNAL', '107.00', '7.00')
  const acct = await ledgerDb.chartAccount.findFirstOrThrow({ where: { tenantId: t, code: '2200' } })
  assert.equal(acct.type, 'LIABILITY')
  assert.equal((await entryLines(t, id)).length, 3)
})

test('account 2200 used for something else stops the posting instead of mis-booking tax', async () => {
  const t = tenant()
  await ensurePostingAccounts(t)
  await ledgerDb.chartAccount.update({ where: { tenantId_code: { tenantId: t, code: '2200' } }, data: { type: 'EXPENSE' } })
  await assert.rejects(() => requireSalesTaxPayable(t), /Ledger not configured/)
  await assert.rejects(() => job(t, 'INVOICE_JOURNAL', '107.00', '7.00'), /Ledger not configured/)
  assert.equal(await ledgerDb.journalEntry.count({ where: { tenantId: t } }), 0)
})

test('foreign-currency split: revenue plus tax equals the converted total, to the cent', () => {
  const cases: Array<[number, number, number]> = [
    [107, 7, 1.0837],
    [33.33, 2.33, 0.7351],
    [1999.99, 139.99, 1.3333],
    [0.07, 0.01, 0.6667],
  ]
  for (const [total, tax, fx] of cases) {
    const s = splitBaseAmounts(total, tax, fx)
    assert.equal(s.baseRevenue.plus(s.baseTax).toFixed(2), s.baseTotal.toFixed(2))
    assert.ok(s.baseRevenue.gte(0) && s.baseTax.gte(0))
  }
})

test('property: for random totals, taxes and rates the split always adds back to the total', () => {
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 2000; i++) {
    const subtotal = Math.round(rnd() * 500000) / 100
    const tax = Math.round(subtotal * rnd() * 0.15 * 100) / 100
    const fx = 0.2 + rnd() * 3
    const s = splitBaseAmounts(+(subtotal + tax).toFixed(2), tax, fx)
    assert.equal(s.baseRevenue.plus(s.baseTax).toFixed(2), s.baseTotal.toFixed(2))
    assert.ok(s.baseRevenue.gte(0))
  }
})

test('end to end: issued invoice and credit memo post revenue and tax separately and reports follow', async () => {
  const t = tenant()
  await ensurePostingAccounts(t)
  const skuId = `sku-${randomUUID()}`
  const order = await orderDb.order.create({
    data: {
      tenantId: t,
      customerId: `cust-${randomUUID()}`,
      channel: 'API',
      status: 'SHIPPED',
      totalAmount: new Prisma.Decimal('107.00'),
      taxAmount: new Prisma.Decimal('7.00'),
      paymentMethod: 'NET_TERMS',
      lineItems: { create: [{ skuId, warehouseId: 'wh', quantity: 10, unitPrice: new Prisma.Decimal('10.00') }] },
    },
    include: { lineItems: true },
  })
  const invoice = await issueInvoiceForOrder(t, order.id)
  await runPostingJobs({ tenantId: t })
  const posted = await orderDb.invoice.findFirstOrThrow({ where: { id: invoice.id } })
  assert.deepEqual(await entryLines(t, posted.journalEntryId!), [
    { code: '1200', debit: '107.00', credit: '0.00' },
    { code: '2200', debit: '0.00', credit: '7.00' },
    { code: '4000', debit: '0.00', credit: '100.00' },
  ])

  const year = new Date().getFullYear()
  const income = await getIncomeStatement(t, `${year}-01-01`, `${year}-12-31`)
  assert.equal(income.revenue.total, 100)
  const sheet = await getBalanceSheet(t, `${year}-12-31`)
  const payable = JSON.stringify(sheet).includes('Sales Tax Payable')
  assert.ok(payable, 'balance sheet lists Sales Tax Payable')

  await applyCreditMemo(
    t,
    { orderId: order.id, reason: 'return', restock: false, lines: [{ lineItemId: order.lineItems[0].id, quantity: 10 }] },
    'test',
  )
  await runPostingJobs({ tenantId: t })
  const after = await getIncomeStatement(t, `${year}-01-01`, `${year}-12-31`)
  assert.equal(after.revenue.total, 0)
  const payableAcct = await ledgerDb.chartAccount.findFirstOrThrow({ where: { tenantId: t, code: '2200' } })
  const lines = await ledgerDb.journalLine.findMany({ where: { accountId: payableAcct.id } })
  const net = lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0)
  assert.equal(+net.toFixed(2), 0, 'tax payable nets to zero after a full credit')
})

test('backfill moves tax from revenue to payable once, and skips invoices already posted correctly', async () => {
  const { planTaxReclass, applyTaxReclass } = await import('./tax-reclass')
  const t = tenant()
  await ensurePostingAccounts(t)
  const mk = async (tax: string, total: string) => {
    const order = await orderDb.order.create({
      data: {
        tenantId: t,
        customerId: `cust-${randomUUID()}`,
        channel: 'API',
        status: 'SHIPPED',
        totalAmount: new Prisma.Decimal(total),
        taxAmount: new Prisma.Decimal(tax),
        paymentMethod: 'NET_TERMS',
        lineItems: { create: [{ skuId: `sku-${randomUUID()}`, warehouseId: 'wh', quantity: 1, unitPrice: new Prisma.Decimal((Number(total) - Number(tax)).toFixed(2)) }] },
      },
    })
    return issueInvoiceForOrder(t, order.id)
  }

  // An old-style invoice: the job is rewritten to the pre-fix shape, so the whole total goes to revenue.
  const old = await mk('7.00', '107.00')
  await orderDb.postingJob.updateMany({
    where: { tenantId: t, sourceId: old.id },
    data: { payload: { amount: '107.00' } },
  })
  const fresh = await mk('3.50', '53.50')
  await runPostingJobs({ tenantId: t })

  const plan = await planTaxReclass(t)
  assert.deepEqual(
    plan.map((r) => [r.invoiceId, r.reclass]),
    [[old.id, '7.00']],
  )
  assert.equal(await applyTaxReclass(plan), 1)
  assert.equal(await applyTaxReclass(plan), 1, 'a replayed plan reuses the same keyed entry')
  assert.equal(await ledgerDb.journalEntry.count({ where: { tenantId: t, sourceType: 'TAX_RECLASS' } }), 1)
  assert.deepEqual(await planTaxReclass(t), [], 'nothing left to move')

  const payable = await ledgerDb.chartAccount.findFirstOrThrow({ where: { tenantId: t, code: '2200' } })
  const lines = await ledgerDb.journalLine.findMany({ where: { accountId: payable.id } })
  assert.equal(lines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0).toFixed(2), '10.50')
  assert.ok(fresh.id)
})
