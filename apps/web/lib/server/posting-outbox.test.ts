import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Prisma } from '@/generated/prisma-order'
import { ledgerDb, orderDb } from './db'
import { issueInvoiceForOrder } from './invoices'
import {
  MAX_POSTING_ATTEMPTS,
  POSTING_BACKOFF_MS,
  enqueuePostingJob,
  findInvoicesMissingPosting,
  listPostingJobs,
  postJob,
  postingQueueStats,
  retryPostingJob,
  runPostingJobs,
} from './posting-outbox'
import { LedgerNotConfiguredError, ensurePostingAccounts, missingPostingAccounts } from './ledger-posting'

async function seedOrder(tenantId: string, total = 100) {
  const order = await orderDb.order.create({
    data: {
      tenantId,
      customerId: `cust-${randomUUID()}`,
      channel: 'API',
      status: 'CONFIRMED',
      totalAmount: new Prisma.Decimal(total),
      taxAmount: new Prisma.Decimal(0),
      paymentMethod: 'NET_TERMS',
      lineItems: {
        create: [
          { skuId: `sku-${randomUUID()}`, warehouseId: 'wh', quantity: 1, unitPrice: new Prisma.Decimal(total) },
        ],
      },
    },
  })
  return order
}

const tenant = () => `t-${randomUUID()}`

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
// The fake clock starts just after the jobs are created so they are due.
const T0 = new Date(Date.now() + 5_000)
const after = (ms: number) => new Date(T0.getTime() + ms)

async function jobFor(invoiceId: string) {
  return orderDb.postingJob.findFirstOrThrow({ where: { sourceType: 'Invoice', sourceId: invoiceId, kind: 'INVOICE_JOURNAL' } })
}

test('issuing an invoice creates the invoice and its posting job together, and posts nothing inline', async () => {
  const tenantId = tenant()
  const order = await seedOrder(tenantId, 125.5)
  const invoice = await issueInvoiceForOrder(tenantId, order.id)
  const job = await jobFor(invoice.id)
  assert.equal(job.status, 'PENDING')
  assert.equal((job.payload as { amount: string }).amount, '125.50')
  assert.equal(job.dedupeKey, `${tenantId}:INVOICE_JOURNAL:Invoice:${invoice.id}:`)
  assert.equal(invoice.journalEntryId, null)
  assert.equal(await ledgerDb.journalEntry.count({ where: { tenantId } }), 0)
})

test('if the job cannot be written, the invoice is not created either', async () => {
  const tenantId = tenant()
  const order = await seedOrder(tenantId)
  const realTx = orderDb.$transaction.bind(orderDb) as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>
  const failingJobInsert = (fn: (tx: unknown) => Promise<unknown>) =>
    realTx((tx) =>
      fn(
        new Proxy(tx as object, {
          get: (t, k) =>
            k === 'postingJob'
              ? { upsert: async () => { throw new Error('injected: job insert failed') } }
              : (t as Record<string | symbol, unknown>)[k],
        }),
      ),
    )
  await withPatched(orderDb, '$transaction', failingJobInsert, () =>
    assert.rejects(issueInvoiceForOrder(tenantId, order.id), /injected/),
  )
  assert.equal(await orderDb.invoice.count({ where: { tenantId } }), 0)
  assert.equal(await orderDb.postingJob.count({ where: { tenantId } }), 0)
})

test('the worker posts a pending job and links the journal entry to the invoice', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const order = await seedOrder(tenantId, 80)
  const invoice = await issueInvoiceForOrder(tenantId, order.id)
  const res = await runPostingJobs({ tenantId })
  assert.deepEqual(res, { claimed: 1, done: 1, failed: 0, dead: 0 })
  const job = await jobFor(invoice.id)
  assert.equal(job.status, 'DONE')
  assert.ok(job.journalEntryId)
  const inv = await orderDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
  assert.equal(inv.journalEntryId, job.journalEntryId)
  const entry = await ledgerDb.journalEntry.findUniqueOrThrow({ where: { id: job.journalEntryId! }, include: { lines: true } })
  assert.equal(entry.sourceType, 'Invoice')
  assert.equal(entry.sourceId, invoice.id)
  const debit = entry.lines.reduce((s, l) => s + Number(l.debit), 0)
  const credit = entry.lines.reduce((s, l) => s + Number(l.credit), 0)
  assert.equal(debit, 80)
  assert.equal(credit, 80)
})

test('a ledger outage leaves the job pending with a backoff, and a later run completes it without help', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const order = await seedOrder(tenantId)
  const invoice = await issueInvoiceForOrder(tenantId, order.id)

  const down = await withPatched(
    ledgerDb,
    'chartAccount',
    { findMany: async () => { throw new Error('ledger db unavailable') } },
    () => runPostingJobs({ tenantId, now: T0 }),
  )
  assert.equal(down.failed, 1)
  let job = await jobFor(invoice.id)
  assert.equal(job.status, 'PENDING')
  assert.equal(job.attempts, 1)
  assert.match(job.lastError ?? '', /ledger db unavailable/)
  assert.equal(job.nextAttemptAt.getTime(), T0.getTime() + POSTING_BACKOFF_MS[0])

  // Not due yet: nothing happens.
  assert.equal((await runPostingJobs({ tenantId, now: after(30_000) })).claimed, 0)
  // Due: succeeds.
  assert.equal((await runPostingJobs({ tenantId, now: after(POSTING_BACKOFF_MS[0] + 1) })).done, 1)
  job = await jobFor(invoice.id)
  assert.equal(job.status, 'DONE')
  assert.equal(job.attempts, 2)
})

test('posting the same job twice, sequentially or in parallel, creates exactly one balanced entry', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const order = await seedOrder(tenantId, 42)
  const invoice = await issueInvoiceForOrder(tenantId, order.id)
  const job = await jobFor(invoice.id)
  const row = { ...job, kind: job.kind as 'INVOICE_JOURNAL' }

  const ids = await Promise.all([postJob(row), postJob(row), postJob(row), postJob(row)])
  assert.equal(new Set(ids).size, 1)
  assert.equal(await postJob(row), ids[0])
  const entries = await ledgerDb.journalEntry.findMany({ where: { tenantId }, include: { lines: true } })
  assert.equal(entries.length, 1)
  assert.equal(entries[0].lines.length, 2)
})

test('two workers racing for one job claim it once', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const order = await seedOrder(tenantId)
  await issueInvoiceForOrder(tenantId, order.id)
  const [a, b] = await Promise.all([runPostingJobs({ tenantId }), runPostingJobs({ tenantId })])
  assert.equal(a.claimed + b.claimed, 1)
  assert.equal(await ledgerDb.journalEntry.count({ where: { tenantId } }), 1)
})

test('a tenant missing accounts gets a visible failed job; creating the accounts lets it complete', async () => {
  const tenantId = tenant()
  const order = await seedOrder(tenantId)
  const invoice = await issueInvoiceForOrder(tenantId, order.id)

  await assert.rejects(postJob({ ...(await jobFor(invoice.id)), kind: 'INVOICE_JOURNAL' }), (e: unknown) => {
    assert.ok(e instanceof LedgerNotConfiguredError)
    assert.deepEqual(e.missing, ['1200', '4000'])
    return true
  })

  await runPostingJobs({ tenantId, now: T0 })
  const failed = await jobFor(invoice.id)
  assert.equal(failed.status, 'PENDING')
  assert.match(failed.lastError ?? '', /LedgerNotConfiguredError.*1200, 4000/)

  await ensurePostingAccounts(tenantId)
  await runPostingJobs({ tenantId, now: after(POSTING_BACKOFF_MS[0] + 1) })
  assert.equal((await jobFor(invoice.id)).status, 'DONE')
})

test('retries follow the backoff schedule and the job is DEAD after 8 attempts', async () => {
  const tenantId = tenant()
  const order = await seedOrder(tenantId)
  const invoice = await issueInvoiceForOrder(tenantId, order.id)
  let clock = T0.getTime()
  const delays: number[] = []
  for (let attempt = 1; attempt <= MAX_POSTING_ATTEMPTS; attempt++) {
    await runPostingJobs({ tenantId, now: new Date(clock) })
    const j = await jobFor(invoice.id)
    assert.equal(j.attempts, attempt)
    if (attempt < MAX_POSTING_ATTEMPTS) {
      assert.equal(j.status, 'PENDING')
      delays.push(j.nextAttemptAt.getTime() - clock)
      clock = j.nextAttemptAt.getTime()
    } else {
      assert.equal(j.status, 'DEAD')
    }
  }
  const [m1, m5, m30, h2, h12] = POSTING_BACKOFF_MS
  assert.deepEqual(delays, [m1, m5, m30, h2, h12, h12, h12])

  const stats = await postingQueueStats(tenantId)
  assert.equal(stats.dead, 1)
  assert.equal((await listPostingJobs(tenantId)).length, 1)
  // DEAD jobs are not picked up again on their own.
  assert.equal((await runPostingJobs({ tenantId, now: after(10 * 24 * 3600_000) })).claimed, 0)

  await ensurePostingAccounts(tenantId)
  await retryPostingJob(tenantId, (await jobFor(invoice.id)).id)
  assert.equal((await runPostingJobs({ tenantId })).done, 1)
})

test('a job left RUNNING by a crashed worker is reclaimed once its lease expires', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const order = await seedOrder(tenantId)
  const invoice = await issueInvoiceForOrder(tenantId, order.id)
  await orderDb.postingJob.updateMany({
    where: { tenantId },
    data: { status: 'RUNNING', attempts: 1, leaseUntil: new Date(T0.getTime() + 60_000) },
  })
  assert.equal((await runPostingJobs({ tenantId, now: T0 })).claimed, 0)
  assert.equal((await runPostingJobs({ tenantId, now: after(120_000) })).done, 1)
  assert.equal((await jobFor(invoice.id)).status, 'DONE')
})

test('enqueueing the same posting twice leaves one job, per tenant', async () => {
  const tenantId = tenant()
  const input = { tenantId, kind: 'COGS_JOURNAL' as const, sourceType: 'Order', sourceId: 'o1', variant: 'task-1', amount: '10.00' }
  await enqueuePostingJob(orderDb, input)
  await enqueuePostingJob(orderDb, input)
  await enqueuePostingJob(orderDb, { ...input, variant: 'task-2' })
  assert.equal(await orderDb.postingJob.count({ where: { tenantId } }), 2)
  assert.equal(await enqueuePostingJob(orderDb, { ...input, amount: '0.00', variant: 'zero' }), null)
  // The same source key in another tenant is its own posting.
  const other = tenant()
  await enqueuePostingJob(orderDb, { ...input, tenantId: other })
  assert.equal(await orderDb.postingJob.count({ where: { tenantId: other } }), 1)
})

test('COGS and credit-memo jobs post balanced entries to the right accounts', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const base = { tenantId, sourceType: 'Order', sourceId: 'o-1', variant: 'task-1', payload: { amount: '30.00' } }
  const cogs = (await postJob({ ...base, id: 'j1', kind: 'COGS_JOURNAL' }))!
  const rev = (await postJob({ ...base, id: 'j2', kind: 'COGS_REVERSAL_JOURNAL', sourceType: 'CreditMemo' }))!
  const memo = (await postJob({ ...base, id: 'j3', kind: 'CREDIT_MEMO_JOURNAL', sourceType: 'CreditMemo', sourceId: 'm-1' }))!
  for (const id of [cogs, rev, memo]) {
    const e = await ledgerDb.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { include: { account: true } } } })
    const sum = (f: 'debit' | 'credit') => e.lines.reduce((s, l) => s + Number(l[f]), 0)
    assert.equal(sum('debit'), 30)
    assert.equal(sum('credit'), 30)
  }
  const c = await ledgerDb.journalEntry.findUniqueOrThrow({ where: { id: cogs }, include: { lines: { include: { account: true } } } })
  assert.deepEqual(c.lines.filter((l) => Number(l.debit) > 0).map((l) => l.account.code), ['5000'])
})

test('invoices older than 15 minutes without a posted journal are reported until the job completes', async () => {
  const tenantId = tenant()
  const order = await seedOrder(tenantId)
  const invoice = await issueInvoiceForOrder(tenantId, order.id)
  const now = new Date(Date.now() + 16 * 60_000)
  assert.equal((await findInvoicesMissingPosting({ tenantId, now })).length, 1)
  assert.equal((await findInvoicesMissingPosting({ tenantId })).length, 0, 'a fresh invoice is not yet overdue')
  await ensurePostingAccounts(tenantId)
  await runPostingJobs({ tenantId })
  assert.equal((await findInvoicesMissingPosting({ tenantId, now })).length, 0)
  assert.ok((await orderDb.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).journalEntryId)
})

test('manual journal entries without a source never collide on the unique key', async () => {
  const tenantId = tenant()
  for (let i = 0; i < 3; i++) {
    await ledgerDb.journalEntry.create({ data: { tenantId, description: `manual ${i}` } })
  }
  assert.equal(await ledgerDb.journalEntry.count({ where: { tenantId, sourceType: null } }), 3)
})

test('provisioning creates every posting account and never reactivates a deactivated one', async () => {
  const tenantId = tenant()
  assert.equal((await missingPostingAccounts(tenantId)).length, 7)
  await ensurePostingAccounts(tenantId)
  assert.deepEqual(await missingPostingAccounts(tenantId), [])
  await ledgerDb.chartAccount.update({ where: { tenantId_code: { tenantId, code: '4000' } }, data: { isActive: false } })
  await ensurePostingAccounts(tenantId)
  assert.deepEqual(await missingPostingAccounts(tenantId), ['4000'])
})

test('invoicing and dispatch no longer write to the ledger directly', () => {
  for (const f of ['invoices.ts', 'order-orchestration.ts']) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
    assert.ok(!/ledgerDb/.test(src), `${f} must not touch ledgerDb`)
    assert.ok(!/postInvoiceJournal|postCreditMemoJournal|postCogsJournal|postCogsReversalJournal/.test(src), `${f} still posts inline`)
  }
})
