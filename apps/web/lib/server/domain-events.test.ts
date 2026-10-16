import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { after, afterEach, test } from 'node:test'
import { createCustomer } from './crm'
import { crmDb, orderDb, paymentDb, tenantDb } from './db'
import {
  MAX_ATTEMPTS,
  MAX_IMMEDIATE_ATTEMPTS,
  attemptDelivery,
  emitDomainEvent,
  processDueWebhookDeliveries,
  settleWebhookAttempts,
  useWebhookTransport,
  type WebhookTransport,
} from './domain-events'
import { onFulfillmentDispatched, tryCaptureAuthorizedPayment } from './order-orchestration'
import { applyCapturedPayment } from './order-payment-sync'
import { deleteWebhook, webhookSigningSecret } from './webhooks'

const tenants: string[] = []
function newTenant() {
  const id = `t-${randomUUID()}`
  tenants.push(id)
  return id
}

/** A public IP literal: passes the internal-address check without a DNS lookup. */
const HOOK_URL = 'https://93.184.216.34/hook'

async function subscribe(tenantId: string, event: string, active = true) {
  return tenantDb.webhookSubscription.create({ data: { tenantId, event, url: HOOK_URL, active } })
}

/** Records every send; answers `status` (a number, or a function of the attempt). */
function recorder(status: number | ((n: number) => number) = 200) {
  const sends: Array<{ headers: Record<string, string>; body: Record<string, unknown>; raw: string }> = []
  const transport: WebhookTransport = async (_url, headers, body) => {
    sends.push({ headers, body: JSON.parse(body), raw: body })
    return typeof status === 'function' ? status(sends.length) : status
  }
  useWebhookTransport(transport)
  return sends
}

/** For events emitted in the background by domain code: wait until `check` passes. */
async function waitFor(check: () => Promise<boolean>, ms = 3000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  assert.fail('timed out waiting for the webhook')
}

afterEach(async () => {
  await settleWebhookAttempts()
  useWebhookTransport(null)
})

after(async () => {
  await tenantDb.webhookDelivery.deleteMany({ where: { tenantId: { in: tenants } } })
  await tenantDb.webhookSubscription.deleteMany({ where: { tenantId: { in: tenants } } })
  await crmDb.customer.deleteMany({ where: { tenantId: { in: tenants } } })
  await orderDb.order.deleteMany({ where: { tenantId: { in: tenants } } }).catch(() => undefined)
  await paymentDb.ledgerEntry.deleteMany({ where: { tenantId: { in: tenants } } }).catch(() => undefined)
  await paymentDb.paymentIntent.deleteMany({ where: { tenantId: { in: tenants } } }).catch(() => undefined)
})

test('"All events" and exact subscriptions receive an event; others and inactive ones do not', async () => {
  const tenantId = newTenant()
  const all = await subscribe(tenantId, '*')
  const exact = await subscribe(tenantId, 'order.shipped')
  await subscribe(tenantId, 'order.created')
  await subscribe(tenantId, 'order.shipped', false)
  const sends = recorder()

  await emitDomainEvent(tenantId, 'order.shipped', { orderId: 'o-1' })
  await settleWebhookAttempts()

  assert.equal(sends.length, 2)
  const deliveries = await tenantDb.webhookDelivery.findMany({ where: { tenantId } })
  assert.deepEqual(deliveries.map((d) => d.subscriptionId).sort(), [all.id, exact.id].sort())
  assert.ok(deliveries.every((d) => d.status === 'DELIVERED' && d.attempts === 1))

  // Same body shape as the test webhook, signed, with a per-delivery id header.
  const { headers, body, raw } = sends[0]!
  assert.deepEqual(Object.keys(body).sort(), ['data', 'event', 'id', 'tenantId', 'timestamp'])
  assert.equal(body.event, 'order.shipped')
  assert.deepEqual(body.data, { orderId: 'o-1' })
  assert.equal(headers['X-Pleros-Event'], 'order.shipped')
  assert.ok(deliveries.some((d) => d.id === headers['X-Pleros-Delivery']))
  const expected = createHmac('sha256', webhookSigningSecret(tenantId)).update(raw).digest('hex')
  assert.equal(headers['X-Pleros-Signature'], expected)
})

test('the same occurrence goes out once per subscription; distinct ones each go out', async () => {
  const tenantId = newTenant()
  await subscribe(tenantId, 'order.shipped')
  const sends = recorder()
  await emitDomainEvent(tenantId, 'order.shipped', { orderId: 'o-1' }, { key: 'task-1' })
  await emitDomainEvent(tenantId, 'order.shipped', { orderId: 'o-1' }, { key: 'task-1' })
  await emitDomainEvent(tenantId, 'order.shipped', { orderId: 'o-1' }, { key: 'task-2' })
  await emitDomainEvent(tenantId, 'order.shipped', { orderId: 'o-1' }) // no key: never deduped
  await settleWebhookAttempts()
  assert.equal(sends.length, 3)
})

test('a failed delivery retries with backoff, resends the same body, and gives up at the cap', async () => {
  const tenantId = newTenant()
  await subscribe(tenantId, 'order.created')
  const sends = recorder(500)
  await emitDomainEvent(tenantId, 'order.created', { orderId: 'o-1' })
  await settleWebhookAttempts()

  let row = (await tenantDb.webhookDelivery.findFirst({ where: { tenantId } }))!
  assert.equal(row.status, 'PENDING')
  assert.equal(row.attempts, 1)
  assert.equal(row.lastStatusCode, 500)
  assert.match(String(row.lastError), /500/)
  const wait = row.nextAttemptAt.getTime() - Date.now()
  assert.ok(wait > 50_000 && wait <= 60_000, `first retry about a minute later (${wait} ms)`)

  // Not due yet: the sweep leaves it alone.
  await processDueWebhookDeliveries()
  assert.equal(sends.length, 1)

  // Due, and on its last attempt: it is sent once more (same body) and then given up.
  await tenantDb.webhookDelivery.update({
    where: { id: row.id },
    data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) },
  })
  await processDueWebhookDeliveries()
  row = (await tenantDb.webhookDelivery.findUniqueOrThrow({ where: { id: row.id } }))
  assert.equal(sends.length, 2)
  assert.equal(sends[1]!.raw, sends[0]!.raw)
  assert.equal(sends[1]!.headers['X-Pleros-Attempt'], String(MAX_ATTEMPTS))
  assert.equal(row.status, 'FAILED')
  assert.equal(row.attempts, MAX_ATTEMPTS)
})

test('two senders reaching the same delivery send it once', async () => {
  const tenantId = newTenant()
  const sub = await subscribe(tenantId, 'order.created')
  const row = await tenantDb.webhookDelivery.create({
    data: { tenantId, subscriptionId: sub.id, event: 'order.created', body: '{"id":"x"}' },
  })
  const sends = recorder()
  await Promise.all([attemptDelivery(row.id), attemptDelivery(row.id), processDueWebhookDeliveries()])
  assert.equal(sends.length, 1)
})

test('a turned-off webhook is not sent to, and deleting one drops its queued retries', async () => {
  const tenantId = newTenant()
  const sub = await subscribe(tenantId, 'order.created')
  const sends = recorder(503)
  await emitDomainEvent(tenantId, 'order.created', { orderId: 'o-1' })
  await settleWebhookAttempts()
  assert.equal(sends.length, 1)

  await tenantDb.webhookSubscription.update({ where: { id: sub.id }, data: { active: false } })
  await tenantDb.webhookDelivery.updateMany({ where: { tenantId }, data: { nextAttemptAt: new Date(Date.now() - 1000) } })
  await processDueWebhookDeliveries()
  assert.equal(sends.length, 1)
  assert.equal((await tenantDb.webhookDelivery.findFirstOrThrow({ where: { tenantId } })).status, 'FAILED')

  await deleteWebhook(tenantId, sub.id)
  assert.equal(await tenantDb.webhookDelivery.count({ where: { tenantId } }), 0)
})

test('a broken webhook layer never breaks the business action', async () => {
  const tenantId = newTenant()
  await subscribe(tenantId, 'crm.customer_created')
  useWebhookTransport(async () => {
    throw new Error('endpoint exploded')
  })
  const prevEnv = process.env.NODE_ENV
  const prevSecret = process.env.WEBHOOK_SIGNING_SECRET
  process.env.NODE_ENV = 'production' // signing now throws too: no WEBHOOK_SIGNING_SECRET
  delete process.env.WEBHOOK_SIGNING_SECRET
  try {
    const customer = await createCustomer(tenantId, { name: 'Still Created' })
    assert.equal(customer.name, 'Still Created')
    await waitFor(async () => (await tenantDb.webhookDelivery.count({ where: { tenantId, attempts: 1 } })) === 1)
    const row = (await tenantDb.webhookDelivery.findFirstOrThrow({ where: { tenantId } }))
    assert.equal(row.status, 'PENDING')
    assert.match(String(row.lastError), /WEBHOOK_SIGNING_SECRET/)
  } finally {
    process.env.NODE_ENV = prevEnv
    if (prevSecret === undefined) delete process.env.WEBHOOK_SIGNING_SECRET
    else process.env.WEBHOOK_SIGNING_SECRET = prevSecret
  }
})

test('wired: customer created reaches its subscribers', async () => {
  const tenantId = newTenant()
  await subscribe(tenantId, 'crm.customer_created')
  const sends = recorder()
  const customer = await createCustomer(tenantId, { name: 'Acme', email: 'buyer@acme.test' })
  await waitFor(async () => sends.length === 1)
  assert.equal(sends[0]!.body.event, 'crm.customer_created')
  assert.deepEqual((sends[0]!.body.data as { customerId: string }).customerId, customer.id)
})

test('wired: an order that ships in two shipments sends order.shipped twice, each once', async () => {
  const tenantId = newTenant()
  await subscribe(tenantId, 'order.shipped')
  const sends = recorder()
  const order = await orderDb.order.create({
    data: { tenantId, customerId: 'c-1', channel: 'B2B_PORTAL', totalAmount: 100, paymentMethod: 'NET_TERMS', status: 'PACKED' },
  })
  await onFulfillmentDispatched(tenantId, order.id, [], 'task-1')
  await onFulfillmentDispatched(tenantId, order.id, [], 'task-1') // the same task, handled again
  await onFulfillmentDispatched(tenantId, order.id, [], 'task-2') // the backordered remainder
  await waitFor(async () => sends.length === 2)
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(sends.length, 2)
  const data = sends.map((s) => s.body.data as { orderId: string; status: string; fulfillmentTaskId: string })
  assert.deepEqual(data.map((d) => d.fulfillmentTaskId).sort(), ['task-1', 'task-2'])
  assert.ok(data.every((d) => d.orderId === order.id && d.status === 'SHIPPED'))
})

test('wired: a captured payment sends finance.payment_captured once per payment', async () => {
  const tenantId = newTenant()
  await subscribe(tenantId, 'finance.payment_captured')
  const sends = recorder()
  const order = await orderDb.order.create({
    data: { tenantId, customerId: 'c-1', channel: 'B2B_PORTAL', totalAmount: 100, paymentMethod: 'CARD' },
  })
  await applyCapturedPayment(tenantId, order.id, 40, { paymentIntentId: 'pi-1' })
  await applyCapturedPayment(tenantId, order.id, 40, { paymentIntentId: 'pi-1' })
  await applyCapturedPayment(tenantId, order.id, 60, { paymentIntentId: 'pi-2' })
  await waitFor(async () => sends.length === 2)
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(sends.length, 2)
  const amounts = sends.map((s) => (s.body.data as { amount: number }).amount).sort()
  assert.deepEqual(amounts, [40, 60])
})

test('a burst of events never opens more than a few connections at once; the rest go via the sweep', async () => {
  const tenantId = newTenant()
  await subscribe(tenantId, '*')
  let open = 0
  let peak = 0
  let sent = 0
  useWebhookTransport(async () => {
    open++
    peak = Math.max(peak, open)
    await new Promise((r) => setTimeout(r, 20))
    open--
    sent++
    return 200
  })
  for (let i = 0; i < 50; i++) await emitDomainEvent(tenantId, 'crm.customer_created', { customerId: `c-${i}` })
  await settleWebhookAttempts()
  while ((await processDueWebhookDeliveries()).attempted > 0) {
    /* drain, one bounded pass at a time */
  }
  assert.equal(sent, 50)
  assert.ok(peak <= MAX_IMMEDIATE_ATTEMPTS, `peak ${peak} concurrent sends`)
  assert.equal(await tenantDb.webhookDelivery.count({ where: { tenantId, status: 'DELIVERED' } }), 50)
})

test('capturing at pack time counts a partial payment once, not twice', async () => {
  const tenantId = newTenant()
  const order = await orderDb.order.create({
    data: { tenantId, customerId: 'c-1', channel: 'B2B_PORTAL', totalAmount: 100, paymentMethod: 'CARD' },
  })
  await paymentDb.paymentIntent.create({
    data: {
      tenantId, orderId: order.id, amount: 40, paymentMethod: 'CARD', customerId: 'c-1',
      correlationId: randomUUID(), metadata: {}, status: 'AUTHORIZED',
    },
  })
  const res = await tryCaptureAuthorizedPayment(tenantId, order.id, randomUUID())
  assert.equal(res.captured, true)
  assert.equal(Number((await orderDb.order.findUniqueOrThrow({ where: { id: order.id } })).amountPaid), 40)
})
