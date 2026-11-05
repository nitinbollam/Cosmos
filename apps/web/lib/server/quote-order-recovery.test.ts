/**
 * Ticket #3, phase 3B-3: order side-effect recovery. A quote order whose placement stopped after the order row was
 * saved is finished by a later request (or a concurrent one): fulfilment, credit approval, webhook and email each
 * happen exactly once, or at most once, and nothing that may already have reached the customer is resent.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { Prisma as OrderPrisma } from '@/generated/prisma-order'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, notificationDb, orderDb, storefrontDb, tenantDb, wmsDb } from './db'
import { setQuoteRaceHookForTests, type QuoteRacePoint } from './quotes'
import { creditApprovalIdFor, RESUME_NOTICE_MAX_AGE_MS, resumeOrderPlacement, setOrderFaultForTests } from './orders'
import { settleWebhookAttempts, useWebhookTransport } from './domain-events'
import { orderCreatedEmailKey } from './notification-triggers'

const PASSWORD = 'quote-recovery-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const buyerEmail = `buyer-${randomUUID().slice(0, 6)}@example.test`
const skuCode = `RC-${randomUUID().slice(0, 5)}`
let customerId = ''
let creditCustomerId = ''
let skuId = ''
let warehouseId = ''
const webhookSends: string[] = []

async function makeUser(key: string, tenantId: string, role: 'STAFF' | 'MANAGER', email = `${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`) {
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role, permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  tok[key] = (await loginUser(email, PASSWORD)).accessToken
}

async function call(key: string, method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${tok[key]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> }
}

async function makeTenant(id: string) {
  await authDb.tenant.create({ data: { id, name: 'R', slug: `r-${id.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id, slug: `r-${id.slice(-8)}`, displayName: 'R', settings: { salesTaxRate: 0 }, metadata: {} },
  })
}

async function waitFor(check: () => Promise<boolean>, what: string, ms = 5000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  assert.fail(`timed out waiting for ${what}`)
}

/** An approved quote: the buyer's own (portal customer), or staff-raised for the low-credit customer. */
async function approvedQuote(opts: { forCredit?: boolean } = {}): Promise<string> {
  const who = opts.forCredit ? 'm1' : 'buyer'
  const customerRef = opts.forCredit ? creditCustomerId : customerId
  const created = await call(who, 'POST', '/quotes', { customerRef, lines: [{ lineNo: 1, skuCode, description: 'Pens', qty: 10, unitPrice: 20 }] })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.id as string
  assert.equal((await call(who, 'POST', `/quotes/${id}/request-approval`)).status, 200)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  return id
}

/**
 * Places the quote's order and stops right after the order row is saved: createOrder fails after its insert and
 * the request "crashes" before it can resume anything. Returns the stranded order's id.
 */
async function strandedOrder(opts: { forCredit?: boolean } = {}): Promise<string> {
  const id = await approvedQuote(opts)
  let fired = false
  setQuoteRaceHookForTests(async (p: QuoteRacePoint) => {
    if (p === 'submit:resume' && !fired) {
      fired = true
      throw new Error('simulated crash before the side effects were resumed')
    }
  })
  setOrderFaultForTests(() => {
    throw new Error('simulated failure right after the order insert')
  })
  try {
    const res = await call(opts.forCredit ? 'm1' : 'buyer', 'POST', `/quotes/${id}/submit`)
    assert.equal(res.status, 500, JSON.stringify(res.body))
  } finally {
    setOrderFaultForTests(null)
    setQuoteRaceHookForTests(null)
  }
  assert.ok(fired, 'the in-request resume was interrupted')
  const [order] = await orderDb.order.findMany({ where: { tenantId: tenantA, sourceQuoteId: id } })
  assert.ok(order, 'the order row exists')
  return order.id
}

/** Everything placing an order produces, counted per order. */
async function effects(orderId: string) {
  const [saga, reservations, tasks, email, deliveries, approvals, credit, order] = await Promise.all([
    orderDb.orderSaga.findUnique({ where: { orderId } }),
    inventoryDb.stockReservation.findMany({ where: { tenantId: tenantA, orderId } }),
    wmsDb.fulfillmentTask.findMany({ where: { tenantId: tenantA, orderId } }),
    notificationDb.notificationRequest.findMany({ where: { tenantId: tenantA, idempotencyKey: orderCreatedEmailKey(orderId) } }),
    tenantDb.webhookDelivery.findMany({ where: { tenantId: tenantA, eventKey: `order.created:${orderId}` } }),
    tenantDb.approvalRequest.findMany({ where: { tenantId: tenantA, subjectId: orderId } }),
    crmDb.creditApplication.findMany({ where: { tenantId: tenantA, orderId } }),
    orderDb.order.findUniqueOrThrow({ where: { id: orderId }, include: { lineItems: true } }),
  ])
  return {
    saga: saga?.status ?? null,
    reserved: reservations.filter((r) => r.status === 'ACTIVE').reduce((n, r) => n + r.quantity, 0),
    reservations: reservations.length,
    tasks: tasks.length,
    emails: email.length,
    emailRow: email[0] ?? null,
    webhooks: deliveries.length,
    approvals,
    creditApplied: credit.length,
    status: order.status,
    allocated: order.lineItems.reduce((n, li) => n + li.quantityAllocated, 0),
  }
}

/** Waits until the order's fulfilment and its email have settled (background work in the original request). */
async function settled(orderId: string) {
  await waitFor(async () => (await orderDb.orderSaga.findUnique({ where: { orderId } }))?.status === 'COMPLETED', 'the saga')
  await waitFor(async () => (await effects(orderId)).emails === 1, 'the email record')
  await settleWebhookAttempts()
}

before(async () => {
  await makeTenant(tenantA)
  await makeTenant(tenantB)
  customerId = (await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Buyer Co', email: buyerEmail } })).id
  creditCustomerId = (await crmDb.customer.create({
    data: { tenantId: tenantA, name: 'Tight Credit Co', email: `credit-${randomUUID().slice(0, 6)}@example.test`, creditLimit: new Prisma.Decimal('50') },
  })).id
  warehouseId = (await inventoryDb.warehouse.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN', address: {}, isDefault: true } })).id
  skuId = (await inventoryDb.sKU.create({
    data: { tenantId: tenantA, code: skuCode, name: 'Pens', category: 'Office', cost: new Prisma.Decimal('9'), price: new Prisma.Decimal('24'), imageUrls: [], attributes: {} },
  })).id
  await inventoryDb.stockLevel.create({
    data: { tenantId: tenantA, skuId, warehouseId, batchId: '', quantityOnHand: 100000, quantityAvailable: 100000 },
  })
  await makeUser('buyer', tenantA, 'STAFF', buyerEmail)
  await makeUser('m1', tenantA, 'MANAGER')
  // A public IP literal passes the internal-address check without DNS; the transport below never sends anything.
  await tenantDb.webhookSubscription.create({ data: { tenantId: tenantA, event: 'order.created', url: 'https://93.184.216.34/hook', active: true } })
  useWebhookTransport(async (_url, _headers, body) => {
    webhookSends.push(body)
    return 200
  })
})

afterEach(async () => {
  setQuoteRaceHookForTests(null)
  setOrderFaultForTests(null)
  await settleWebhookAttempts()
})

after(async () => {
  await new Promise((r) => setTimeout(r, 500)) // let fire-and-forget work finish
  await settleWebhookAttempts()
  useWebhookTransport(null)
  for (const t of [tenantA, tenantB]) {
    await storefrontDb.b2BQuote.deleteMany({ where: { tenantId: t } })
    await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await orderDb.backorderLine.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await orderDb.order.deleteMany({ where: { tenantId: t } })
    await orderDb.orderCounter.deleteMany({ where: { tenantId: t } })
    await inventoryDb.stockReservation.deleteMany({ where: { tenantId: t } })
    await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await inventoryDb.stockLevel.deleteMany({ where: { tenantId: t } })
    await inventoryDb.sKU.deleteMany({ where: { tenantId: t } })
    await inventoryDb.warehouse.deleteMany({ where: { tenantId: t } })
    await crmDb.creditApplication.deleteMany({ where: { tenantId: t } })
    await crmDb.customer.deleteMany({ where: { tenantId: t } })
    await notificationDb.notificationRequest.deleteMany({ where: { tenantId: t } })
    await tenantDb.webhookDelivery.deleteMany({ where: { tenantId: t } })
    await tenantDb.webhookSubscription.deleteMany({ where: { tenantId: t } })
    await tenantDb.approvalRequest.deleteMany({ where: { tenantId: t } })
  }
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
  await authDb.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
})

// ---- 1-3: a stranded order is finished, exactly once ----

test('1. an order stranded right after its insert has none of its side effects', async () => {
  const orderId = await strandedOrder()
  const e = await effects(orderId)
  assert.deepEqual(
    [e.saga, e.reservations, e.tasks, e.emails, e.webhooks, e.creditApplied, e.status],
    [null, 0, 0, 0, 0, 0, 'PENDING'],
  )
})

test('2. a retry finishes it: one reservation of the full quantity, one warehouse task, one webhook, one email', async () => {
  const orderId = await strandedOrder()
  const quote = await storefrontDb.b2BQuote.findFirstOrThrow({ where: { tenantId: tenantA, convertedOrderId: orderId } })
  const res = await call('buyer', 'POST', `/quotes/${quote.id}/submit`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.convertedOrderId, orderId)
  await settleWebhookAttempts()
  const e = await effects(orderId)
  assert.deepEqual(
    [e.saga, e.reserved, e.allocated, e.tasks, e.emails, e.emailRow?.status, e.webhooks, e.creditApplied, e.status],
    ['COMPLETED', 10, 10, 1, 1, 'SENT', 1, 1, 'PROCESSING'],
  )

  // Repeats change nothing, and the email record is not touched again.
  const emailAt = e.emailRow!.updatedAt.getTime()
  for (let i = 0; i < 3; i++) assert.equal((await call('buyer', 'POST', `/quotes/${quote.id}/submit`)).status, 200)
  await settleWebhookAttempts()
  const again = await effects(orderId)
  assert.deepEqual(
    [again.reservations, again.reserved, again.tasks, again.emails, again.webhooks, again.creditApplied],
    [e.reservations, 10, 1, 1, 1, 1],
  )
  assert.equal(again.emailRow!.updatedAt.getTime(), emailAt, 'the email was not re-delivered')
  assert.equal((await orderDb.order.count({ where: { tenantId: tenantA, sourceQuoteId: quote.id } })), 1)
})

test('3. concurrent retries on a stranded order still produce each side effect once', async () => {
  const orderId = await strandedOrder()
  const quote = await storefrontDb.b2BQuote.findFirstOrThrow({ where: { tenantId: tenantA, convertedOrderId: orderId } })
  const results = await Promise.all([
    call('buyer', 'POST', `/quotes/${quote.id}/submit`),
    call('buyer', 'POST', `/quotes/${quote.id}/submit`),
    call('m1', 'POST', `/quotes/${quote.id}/submit`),
    resumeOrderPlacement(tenantA, orderId).then(() => ({ status: 200, body: {} })),
  ])
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200])
  // A run that found the saga busy left it to the other; wait for that one to finish.
  await waitFor(async () => (await effects(orderId)).saga === 'COMPLETED', 'the saga')
  await settleWebhookAttempts()
  const e = await effects(orderId)
  assert.deepEqual([e.reserved, e.allocated, e.tasks, e.emails, e.webhooks, e.creditApplied], [10, 10, 1, 1, 1, 1])
})

// ---- 4-5: resuming while the original request is still running ----

test('4. a resume racing the original placement (its pipeline and email still in flight) duplicates nothing', async () => {
  const id = await approvedQuote()
  let raced = false
  setQuoteRaceHookForTests(async (p, quoteId) => {
    if (p !== 'submit:after-create' || raced || quoteId !== id) return
    raced = true
    const [order] = await orderDb.order.findMany({ where: { tenantId: tenantA, sourceQuoteId: id } })
    // createOrder has returned; its pipeline, webhook and email were started in the background and may be running.
    await Promise.all([resumeOrderPlacement(tenantA, order.id), resumeOrderPlacement(tenantA, order.id)])
  })
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.ok(raced)
  const orderId = res.body.convertedOrderId as string
  await settled(orderId)
  const e = await effects(orderId)
  assert.deepEqual([e.reserved, e.allocated, e.tasks, e.emails, e.webhooks, e.creditApplied], [10, 10, 1, 1, 1, 1])
})

test('5. a normal conversion followed by repeats: still one of everything (repeats resume nothing new)', async () => {
  const id = await approvedQuote()
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200)
  const orderId = res.body.convertedOrderId as string
  await settled(orderId)
  const first = await effects(orderId)
  await Promise.all([call('buyer', 'POST', `/quotes/${id}/submit`), call('m1', 'POST', `/quotes/${id}/submit`)])
  await settleWebhookAttempts()
  const e = await effects(orderId)
  assert.deepEqual([e.reservations, e.tasks, e.emails, e.webhooks, e.creditApplied], [first.reservations, 1, 1, 1, 1])
  assert.equal(e.emailRow!.updatedAt.getTime(), first.emailRow!.updatedAt.getTime())
})

// ---- 6: customer email is never resent ----

test('6. an email already attempted (failed, or still pending) is never sent again by a resume', async () => {
  for (const status of ['FAILED', 'PENDING'] as const) {
    const orderId = await strandedOrder()
    const row = await notificationDb.notificationRequest.create({
      data: {
        tenantId: tenantA,
        idempotencyKey: orderCreatedEmailKey(orderId),
        channel: 'EMAIL',
        recipient: buyerEmail,
        templateKey: 'order.created',
        payload: {},
        status,
        errorMessage: status === 'FAILED' ? 'provider timed out (may have been delivered)' : null,
      },
    })
    const report = await resumeOrderPlacement(tenantA, orderId)
    assert.equal(report.email, 'already-attempted', status)
    assert.equal(report.pipeline, 'completed', 'the rest is still resumed')
    const now = await notificationDb.notificationRequest.findUniqueOrThrow({ where: { id: row.id } })
    assert.deepEqual([now.status, now.updatedAt.getTime()], [status, row.updatedAt.getTime()], `${status} row untouched`)
    assert.equal((await effects(orderId)).emails, 1)
  }
})

// ---- 7-9: credit approval ----

test('7. a stranded order awaiting credit approval gets exactly one override request, and nothing else', async () => {
  const orderId = await strandedOrder({ forCredit: true })
  let e = await effects(orderId)
  assert.deepEqual([e.status, e.approvals.length], ['AWAITING_APPROVAL', 0], 'stranded before its approval request')

  const quote = await storefrontDb.b2BQuote.findFirstOrThrow({ where: { tenantId: tenantA, convertedOrderId: orderId } })
  const results = await Promise.all([
    call('m1', 'POST', `/quotes/${quote.id}/submit`),
    call('m1', 'POST', `/quotes/${quote.id}/submit`),
    resumeOrderPlacement(tenantA, orderId).then(() => ({ status: 200 })),
  ])
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200])
  e = await effects(orderId)
  assert.equal(e.approvals.length, 1)
  assert.deepEqual([e.approvals[0].id, e.approvals[0].type, e.approvals[0].status], [creditApprovalIdFor(orderId), 'CREDIT_LIMIT_OVERRIDE', 'PENDING'])
  assert.deepEqual([e.saga, e.reservations, e.tasks, e.emails, e.webhooks, e.status], [null, 0, 0, 0, 0, 'AWAITING_APPROVAL'], 'fulfilment waits for the decision')
  assert.equal((await resumeOrderPlacement(tenantA, orderId)).creditApproval, 'already-requested')
})

test('8. a decided override is never re-raised or re-applied by a resume: reported for an operator', async () => {
  const orderId = await strandedOrder({ forCredit: true })
  assert.equal((await resumeOrderPlacement(tenantA, orderId)).creditApproval, 'created')
  // Decided, but the hook that applies the decision never ran (crash): the order is still awaiting approval.
  await tenantDb.approvalRequest.update({ where: { id: creditApprovalIdFor(orderId) }, data: { status: 'APPROVED', decidedBy: 'someone', decidedAt: new Date() } })
  const report = await resumeOrderPlacement(tenantA, orderId)
  assert.equal(report.creditApproval, 'already-decided')
  assert.match(report.limitations.join(' '), /not re-applied/)
  const e = await effects(orderId)
  assert.deepEqual([e.approvals.length, e.status, e.saga, e.emails], [1, 'AWAITING_APPROVAL', null, 0])
})

test('9. the normal conversion of an over-limit quote raises one override with the fixed id; repeats add none', async () => {
  const id = await approvedQuote({ forCredit: true })
  const res = await call('m1', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const orderId = res.body.convertedOrderId as string
  await call('m1', 'POST', `/quotes/${id}/submit`)
  await resumeOrderPlacement(tenantA, orderId)
  const e = await effects(orderId)
  assert.deepEqual(e.approvals.map((a) => a.id), [creditApprovalIdFor(orderId)])
  assert.equal(e.status, 'AWAITING_APPROVAL')
})

// ---- 10-12: pipeline states, limits, isolation ----

test('10. a pipeline that crashed mid-run is taken over after its lease; one still running is left alone', async () => {
  const orderId = await strandedOrder()
  // Fresh RUNNING saga: another worker holds it.
  await orderDb.orderSaga.create({ data: { orderId, tenantId: tenantA, status: 'RUNNING', correlationId: randomUUID(), completedSteps: [], compensations: {} } })
  const busy = await resumeOrderPlacement(tenantA, orderId)
  assert.equal(busy.pipeline, 'already-running')
  assert.deepEqual([(await effects(orderId)).reservations, (await effects(orderId)).tasks], [0, 0])

  // The holder crashed: its lease expires, and the resume takes over, finishing once.
  await orderDb.orderSaga.update({ where: { orderId }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } })
  const taken = await resumeOrderPlacement(tenantA, orderId)
  assert.equal(taken.pipeline, 'completed')
  await resumeOrderPlacement(tenantA, orderId)
  await settleWebhookAttempts()
  const e = await effects(orderId)
  assert.deepEqual([e.saga, e.reserved, e.tasks, e.emails, e.webhooks], ['COMPLETED', 10, 1, 1, 1])
})

test('11. an old stranded order is fulfilled but gets no late webhook or email: reported instead', async () => {
  const orderId = await strandedOrder()
  await orderDb.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - RESUME_NOTICE_MAX_AGE_MS - 60_000) } })
  const report = await resumeOrderPlacement(tenantA, orderId)
  assert.deepEqual([report.pipeline, report.event, report.email], ['completed', 'skipped', 'skipped'])
  assert.match(report.limitations.join(' '), /too old/)
  await settleWebhookAttempts()
  const e = await effects(orderId)
  assert.deepEqual([e.saga, e.tasks, e.emails, e.webhooks], ['COMPLETED', 1, 0, 0])
})

test('12. only quote orders of the caller’s tenant are resumed; failed or cancelled orders are left as they are', async () => {
  const orderId = await strandedOrder()
  const foreign = await resumeOrderPlacement(tenantB, orderId)
  assert.match(foreign.limitations.join(' '), /not found/)
  assert.deepEqual([(await effects(orderId)).saga, (await effects(orderId)).emails], [null, 0], 'tenant B touched nothing')

  const plain = await orderDb.order.create({
    data: { tenantId: tenantA, customerId, channel: 'SALES_REP', paymentMethod: 'NET_TERMS', totalAmount: new OrderPrisma.Decimal('5') },
  })
  const notQuote = await resumeOrderPlacement(tenantA, plain.id)
  assert.match(notQuote.limitations.join(' '), /Only orders placed from a quote/)
  assert.equal(await orderDb.orderSaga.count({ where: { orderId: plain.id } }), 0)

  await orderDb.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } })
  const cancelled = await resumeOrderPlacement(tenantA, orderId)
  assert.deepEqual([cancelled.pipeline, cancelled.email, cancelled.event], ['not-needed', 'not-needed', 'not-needed'])
  const e = await effects(orderId)
  assert.deepEqual([e.saga, e.reservations, e.emails, e.webhooks], [null, 0, 0, 0])
})

test('13. the public submit API is unchanged: same answer and fields, no recovery details leak into it', async () => {
  const orderId = await strandedOrder()
  const quote = await storefrontDb.b2BQuote.findFirstOrThrow({ where: { tenantId: tenantA, convertedOrderId: orderId } })
  const res = await call('buyer', 'POST', `/quotes/${quote.id}/submit`)
  assert.equal(res.status, 200)
  for (const k of ['id', 'status', 'convertedOrderId', 'lines', 'version', 'quoteNumber']) assert.ok(k in res.body, k)
  for (const k of ['limitations', 'pipeline', 'creditApproval', 'createdByUserId']) assert.ok(!(k in res.body), `no ${k}`)
  assert.equal(res.body.status, 'SUBMITTED')
})

test('14. a pipeline that fails while resuming sends no webhook or email; the failure is logged with tenant and order ids', async () => {
  const orderId = await strandedOrder()
  // A drop-ship line whose supplier does not exist: the pipeline's drop-ship step fails.
  await orderDb.orderLineItem.updateMany({ where: { orderId }, data: { fulfillmentType: 'DROP_SHIP', supplierId: `missing-${randomUUID()}` } })
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  let res
  try {
    const quote = await storefrontDb.b2BQuote.findFirstOrThrow({ where: { tenantId: tenantA, convertedOrderId: orderId } })
    res = await call('buyer', 'POST', `/quotes/${quote.id}/submit`)
  } finally {
    console.warn = originalWarn
  }
  assert.equal(res.status, 200, 'the order exists and is linked; the response does not claim anything about fulfilment')
  assert.equal(res.body.convertedOrderId, orderId)
  assert.ok(!('pipeline' in res.body) && !('fulfillment' in res.body))
  const report = await resumeOrderPlacement(tenantA, orderId)
  assert.notEqual(report.pipeline, 'completed')
  await settleWebhookAttempts()
  const e = await effects(orderId)
  assert.deepEqual([e.emails, e.webhooks], [0, 0], 'nothing announced for an order whose fulfilment failed')
  const line = warnings.find((w) => w.includes(orderId))
  assert.ok(line, `a warning names the order: ${warnings.join(' | ')}`)
  assert.ok(line!.includes(tenantA), 'and the tenant')
  assert.match(line!, /pipeline failed/)
})
