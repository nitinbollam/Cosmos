import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { ledgerDb, orderDb } from './db'
import { attemptOrQueue, isWorkKind, queueWork, runWork } from './deferred-work'
import { enqueuePostingJob, postJob, runPostingJobs } from './posting-outbox'
import { ensurePostingAccounts } from './ledger-posting'

const tenant = () => `t-${randomUUID()}`

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

async function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => undefined
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

const ref = (tenantId: string, kind: 'INVOICE_SYNC' | 'CREDIT_RELEASE' = 'INVOICE_SYNC', sourceId = 'order-1') => ({
  tenantId,
  kind,
  sourceType: 'Order',
  sourceId,
})

test('isWorkKind separates deferred work from journal kinds', () => {
  assert.equal(isWorkKind('INVOICE_SYNC'), true)
  assert.equal(isWorkKind('DELIVERY_ADVANCE'), true)
  assert.equal(isWorkKind('AR_PAYMENT_JOURNAL'), false)
  assert.equal(isWorkKind('INVOICE_JOURNAL'), false)
})

test('attemptOrQueue returns done and queues nothing when the work succeeds', async () => {
  const tenantId = tenant()
  assert.equal(await attemptOrQueue(ref(tenantId), async () => undefined), 'done')
  assert.equal(await orderDb.postingJob.count({ where: { tenantId } }), 0)
})

test('attemptOrQueue queues a retry when the work fails, and does not throw', async () => {
  const tenantId = tenant()
  const outcome = await silenced(() =>
    attemptOrQueue(ref(tenantId), async () => {
      throw new Error('boom')
    }),
  )
  assert.equal(outcome, 'queued')
  const jobs = await orderDb.postingJob.findMany({ where: { tenantId } })
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].kind, 'INVOICE_SYNC')
  assert.equal(jobs[0].status, 'PENDING')
})

test('attemptOrQueue throws, keeping the cause, when the retry cannot be queued either', async () => {
  const tenantId = tenant()
  const cause = new Error('boom')
  await withPatched(
    orderDb.postingJob,
    'create',
    async () => {
      throw new Error('db down')
    },
    () =>
      silenced(async () => {
        await assert.rejects(
          () =>
            attemptOrQueue(ref(tenantId), async () => {
              throw cause
            }),
          (e: Error) => /could not be queued/.test(e.message) && /db down/.test(e.message) && e.cause === cause,
        )
      }),
  )
})

test('coalescing kinds share one waiting job; credit releases do not', async () => {
  const tenantId = tenant()
  await queueWork(ref(tenantId))
  await queueWork(ref(tenantId))
  assert.equal(await orderDb.postingJob.count({ where: { tenantId, kind: 'INVOICE_SYNC' } }), 1)
  await queueWork({ ...ref(tenantId, 'CREDIT_RELEASE'), payload: { customerId: 'c', amount: 5 } })
  await queueWork({ ...ref(tenantId, 'CREDIT_RELEASE'), payload: { customerId: 'c', amount: 5 } })
  assert.equal(await orderDb.postingJob.count({ where: { tenantId, kind: 'CREDIT_RELEASE' } }), 2)
})

test('DELIVERY_ADVANCE is a no-op for an order that is already delivered or missing', async () => {
  const tenantId = tenant()
  const order = await orderDb.order.create({
    data: {
      tenantId,
      customerId: 'c',
      channel: 'API',
      status: 'DELIVERED',
      totalAmount: new Prisma.Decimal(10),
      taxAmount: new Prisma.Decimal(0),
      paymentMethod: 'NET_TERMS',
      lineItems: { create: [{ skuId: 's', warehouseId: 'w', quantity: 1, unitPrice: new Prisma.Decimal(10) }] },
    },
  })
  await runWork({ tenantId, kind: 'DELIVERY_ADVANCE', sourceType: 'Order', sourceId: order.id })
  await runWork({ tenantId, kind: 'DELIVERY_ADVANCE', sourceType: 'Order', sourceId: 'missing' })
})

test('a queued work job that fails is retried by the worker and ends DONE once it succeeds', async () => {
  const tenantId = tenant()
  // DELIVERY_ADVANCE on a missing order is a safe no-op, so the job completes on the first run.
  await queueWork({ tenantId, kind: 'DELIVERY_ADVANCE', sourceType: 'Order', sourceId: 'gone' })
  const res = await runPostingJobs({ tenantId, now: new Date(Date.now() + 5_000) })
  assert.equal(res.done, 1)
  const job = await orderDb.postingJob.findFirstOrThrow({ where: { tenantId } })
  assert.equal(job.status, 'DONE')
  assert.equal(job.journalEntryId, null)
})

test('AR payment journal debits cash and credits receivables, once per variant', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const input = {
    tenantId,
    kind: 'AR_PAYMENT_JOURNAL' as const,
    sourceType: 'Invoice',
    sourceId: 'inv-1',
    variant: 'intent:pi_1',
    amount: '25.50',
  }
  const a = await enqueuePostingJob(orderDb, input)
  const b = await enqueuePostingJob(orderDb, input)
  assert.equal(a!.id, b!.id)
  const row = await orderDb.postingJob.findUniqueOrThrow({ where: { id: a!.id } })
  const id1 = await postJob({ ...row, kind: 'AR_PAYMENT_JOURNAL' })
  const id2 = await postJob({ ...row, kind: 'AR_PAYMENT_JOURNAL' })
  assert.equal(id1, id2)
  const entries = await ledgerDb.journalEntry.findMany({ where: { tenantId }, include: { lines: { include: { account: true } } } })
  assert.equal(entries.length, 1)
  const byCode = Object.fromEntries(entries[0].lines.map((l) => [l.account.code, l]))
  assert.equal(Number(byCode['1000'].debit), 25.5)
  assert.equal(Number(byCode['1200'].credit), 25.5)
})

test('AP payment journal debits payables and credits cash', async () => {
  const tenantId = tenant()
  await ensurePostingAccounts(tenantId)
  const job = await enqueuePostingJob(orderDb, {
    tenantId,
    kind: 'AP_PAYMENT_JOURNAL',
    sourceType: 'VendorBill',
    sourceId: 'bill-1',
    variant: 'pay:1',
    amount: '80.00',
  })
  const row = await orderDb.postingJob.findUniqueOrThrow({ where: { id: job!.id } })
  await postJob({ ...row, kind: 'AP_PAYMENT_JOURNAL' })
  const entry = await ledgerDb.journalEntry.findFirstOrThrow({ where: { tenantId }, include: { lines: { include: { account: true } } } })
  const byCode = Object.fromEntries(entry.lines.map((l) => [l.account.code, l]))
  assert.equal(Number(byCode['2100'].debit), 80)
  assert.equal(Number(byCode['1000'].credit), 80)
})

test('a payment journal with no ledger accounts fails visibly and stays queued for retry', async () => {
  const tenantId = tenant()
  await enqueuePostingJob(orderDb, {
    tenantId,
    kind: 'AR_PAYMENT_JOURNAL',
    sourceType: 'Invoice',
    sourceId: 'inv-x',
    variant: 'manual:1',
    amount: '10.00',
  })
  const res = await silenced(() => runPostingJobs({ tenantId, now: new Date(Date.now() + 5_000) }))
  assert.equal(res.failed, 1)
  const job = await orderDb.postingJob.findFirstOrThrow({ where: { tenantId } })
  assert.equal(job.status, 'PENDING')
  assert.equal(job.attempts, 1)
  assert.ok(job.lastError)
})
