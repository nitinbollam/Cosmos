import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, notificationDb, orderDb, paymentDb, tenantDb } from './db'
import { settleWebhookAttempts, useWebhookTransport } from './domain-events'
import { recordOrderPayment } from './orders'
import { parsePaymentAmount } from './payment-amount'
import { ApiError } from './session'

const PASSWORD = 'invoice-pay-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
// Finance staff record invoice payments; order payments need orders.write, which an admin has.
let accountantToken = ''
let adminToken = ''
const prevStripeKey = process.env.STRIPE_SECRET_KEY

async function login(role: 'ACCOUNTANT' | 'TENANT_ADMIN') {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: role,
      lastName: 'U',
      role,
      permissions: [],
      emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  return (await loginUser(email, PASSWORD)).accessToken
}

before(async () => {
  // No Stripe key and no Connect account: a card request that got past validation would stop with a
  // 402 here instead of reaching Stripe, and the tests below would fail on the status.
  delete process.env.STRIPE_SECRET_KEY
  // Webhook sends are counted, never sent.
  useWebhookTransport(async () => 200)

  await authDb.tenant.create({ data: { id: tenantId, name: 'Pay', slug: `ipv-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `ipv-${tenantId.slice(-8)}`, displayName: 'Pay', settings: {}, metadata: {} },
  })
  await tenantDb.webhookSubscription.create({
    data: { tenantId, event: 'finance.payment_captured', url: 'https://hooks.example.test/pay' },
  })
  accountantToken = await login('ACCOUNTANT')
  adminToken = await login('TENANT_ADMIN')
})

after(async () => {
  useWebhookTransport(null)
  if (prevStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = prevStripeKey
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await paymentDb.paymentIntent.deleteMany({ where: { tenantId } })
  await notificationDb.notificationRequest.deleteMany({ where: { tenantId } })
  await tenantDb.webhookDelivery.deleteMany({ where: { tenantId } })
  await tenantDb.webhookSubscription.deleteMany({ where: { tenantId } })
  await orderDb.postingJob.deleteMany({ where: { tenantId } })
  await orderDb.invoice.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

/** A shipped NET_TERMS order and its invoice for $51.04 (as on INV-LSZCPSDP), with that much credit in use. */
async function openInvoice(total = '51.04') {
  const email = `buyer-${randomUUID().slice(0, 8)}@example.test`
  const customer = await crmDb.customer.create({ data: { tenantId, name: 'Buyer Co', email, creditUsed: total } })
  const order = await orderDb.order.create({
    data: { tenantId, customerId: customer.id, channel: 'B2B_PORTAL', totalAmount: total, paymentMethod: 'NET_TERMS', status: 'SHIPPED' },
  })
  const invoice = await orderDb.invoice.create({
    data: {
      tenantId, orderId: order.id, invoiceNumber: `INV-${randomUUID().slice(0, 8)}`, customerId: customer.id,
      subtotal: total, taxAmount: 0, totalAmount: total,
    },
  })
  return { orderId: order.id, invoiceId: invoice.id, customerId: customer.id, email }
}
type Inv = Awaited<ReturnType<typeof openInvoice>>

function post(path: string, body: unknown) {
  return handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${path.startsWith('/orders/') ? adminToken : accountantToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

/** Everything a recorded payment changes or produces. */
async function effects(inv: Inv) {
  // Events and notifications are fire-and-forget: let them land before counting.
  await settleWebhookAttempts()
  await new Promise((r) => setTimeout(r, 150))
  const order = await orderDb.order.findUniqueOrThrow({ where: { id: inv.orderId } })
  const invoice = await orderDb.invoice.findUniqueOrThrow({ where: { id: inv.invoiceId } })
  const customer = await crmDb.customer.findUniqueOrThrow({ where: { id: inv.customerId } })
  const jobs = await orderDb.postingJob.findMany({ where: { tenantId, sourceId: inv.invoiceId, kind: 'AR_PAYMENT_JOURNAL' } })
  return {
    orderPaid: order.amountPaid.toFixed(2),
    invoicePaid: invoice.amountPaid.toFixed(2),
    invoiceStatus: invoice.status,
    creditUsed: customer.creditUsed.toFixed(2),
    journalAmounts: jobs.map((j) => (j.payload as { amount: string }).amount).sort(),
    events: await tenantDb.webhookDelivery.count({ where: { tenantId, body: { contains: inv.orderId } } }),
    notifications: await notificationDb.notificationRequest.count({
      where: { tenantId, recipient: inv.email, templateKey: 'payment.received' },
    }),
    cardIntents: await paymentDb.paymentIntent.count({ where: { tenantId, orderId: inv.orderId } }),
  }
}

/** Waits for the fire-and-forget notification of a valid payment, so its count can be asserted. */
async function untilNotified(inv: Inv, count: number) {
  for (let i = 0; i < 40; i++) {
    const n = await notificationDb.notificationRequest.count({ where: { tenantId, recipient: inv.email } })
    if (n >= count) return
    await new Promise((r) => setTimeout(r, 50))
  }
}

const NOT_A_NUMBER = /must be a number/
const NOT_POSITIVE = /must be greater than zero/
const TOO_PRECISE = /at most 2 decimal places/
const OVER_BALANCE = /more than the remaining balance of \$51\.04/

// [label, request body amount (undefined = field left out), expected message]
const INVALID: Array<[string, unknown, RegExp]> = [
  ['negative', -10, NOT_POSITIVE],
  ['negative string', '-10', NOT_POSITIVE],
  ['zero', 0, NOT_POSITIVE],
  ['zero string', '0.00', NOT_POSITIVE],
  ['more than the balance ($90 on $51.04)', 90, OVER_BALANCE],
  ['one cent over the balance', 51.05, OVER_BALANCE],
  ['missing', undefined, NOT_A_NUMBER],
  ['null (also what JSON makes of NaN and Infinity)', null, NOT_A_NUMBER],
  ['empty string', '', NOT_A_NUMBER],
  ['blank string', '   ', NOT_A_NUMBER],
  ['text', 'abc', NOT_A_NUMBER],
  ['number with trailing text', '10abc', NOT_A_NUMBER],
  ['exponent string', '1e2', NOT_A_NUMBER],
  ['currency symbol', '$10', NOT_A_NUMBER],
  ['boolean', true, NOT_A_NUMBER],
  ['object', { value: 10 }, NOT_A_NUMBER],
  ['three decimal places', 10.005, TOO_PRECISE],
  ['three decimal places as a string', '10.005', TOO_PRECISE],
  ['a tenth of a cent', 0.001, TOO_PRECISE],
  ['a tiny float', 1e-7, TOO_PRECISE],
]

for (const route of ['invoice', 'order'] as const) {
  test(`${route} payments: invalid amounts are rejected with a clear message and change nothing`, async () => {
    const inv = await openInvoice()
    const path = route === 'invoice' ? `/invoices/${inv.invoiceId}/payments` : `/orders/${inv.orderId}/payments`
    const before = await effects(inv)
    for (const [label, amount, message] of INVALID) {
      const body: Record<string, unknown> = { method: 'CHECK', reference: `chk-${label}` }
      if (amount !== undefined) body.amount = amount
      const res = await post(path, body)
      assert.equal(res.status, 400, `${label}: status`)
      assert.match(((await res.json()) as { message: string }).message, message, label)
    }
    assert.deepEqual(await effects(inv), before)
    assert.deepEqual(before.journalAmounts, [])
    assert.equal(before.orderPaid, '0.00')
    assert.equal(before.creditUsed, '51.04')
  })
}

test('the service itself rejects NaN and Infinity, which never survive JSON', async () => {
  const inv = await openInvoice()
  for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    await assert.rejects(
      recordOrderPayment(tenantId, inv.orderId, { amount, method: 'CASH' }),
      (e: unknown) => e instanceof ApiError && e.status === 400 && NOT_A_NUMBER.test(e.message),
    )
  }
  assert.equal((await effects(inv)).orderPaid, '0.00')
})

test('a partial payment, then the exact balance, then nothing more', async () => {
  const inv = await openInvoice()

  const partial = await post(`/invoices/${inv.invoiceId}/payments`, { amount: 20, method: 'CHECK', reference: 'chk-1' })
  assert.equal(partial.status, 200)
  await untilNotified(inv, 1)
  assert.deepEqual(await effects(inv), {
    orderPaid: '20.00', invoicePaid: '20.00', invoiceStatus: 'PARTIALLY_PAID', creditUsed: '31.04',
    journalAmounts: ['20.00'], events: 1, notifications: 1, cardIntents: 0,
  })

  // The rest, as the string the form now sends.
  const rest = await post(`/orders/${inv.orderId}/payments`, { amount: '31.04', method: 'ACH', reference: 'ach-1' })
  assert.equal(rest.status, 200)
  await untilNotified(inv, 2)
  const paid = await effects(inv)
  assert.deepEqual(paid, {
    orderPaid: '51.04', invoicePaid: '51.04', invoiceStatus: 'PAID', creditUsed: '0.00',
    journalAmounts: ['20.00', '31.04'], events: 2, notifications: 2, cardIntents: 0,
  })

  const invoiceAgain = await post(`/invoices/${inv.invoiceId}/payments`, { amount: 0.01, method: 'CASH' })
  assert.equal(invoiceAgain.status, 400)
  assert.match(((await invoiceAgain.json()) as { message: string }).message, /already paid/)
  const orderAgain = await post(`/orders/${inv.orderId}/payments`, { amount: 0.01, method: 'CASH' })
  assert.equal(orderAgain.status, 400)
  assert.match(((await orderAgain.json()) as { message: string }).message, /already fully paid/)
  assert.deepEqual(await effects(inv), paid)
})

test('the whole balance in one payment marks the invoice paid', async () => {
  const inv = await openInvoice()
  const res = await post(`/invoices/${inv.invoiceId}/payments`, { amount: 51.04, method: 'CASH' })
  assert.equal(res.status, 200)
  const body = (await res.json()) as { balance: number; displayStatus: string }
  assert.equal(body.balance, 0)
  await untilNotified(inv, 1)
  const after = await effects(inv)
  assert.equal(after.invoiceStatus, 'PAID')
  assert.deepEqual(after.journalAmounts, ['51.04'])
})

/**
 * Holds every balance write for this order until `expected` callers have reached it, so each has
 * read the order before any of them writes. `onRelease` runs once, just before they continue.
 */
function holdBalanceWrites(orderId: string, expected: number, onRelease?: () => Promise<unknown>) {
  const delegate = orderDb.order as unknown as { updateMany: (args: { where?: { id?: string } }) => Promise<{ count: number }> }
  const original = delegate.updateMany.bind(delegate)
  let arrived = 0
  let release!: () => void
  const released = new Promise<void>((r) => (release = r))
  // Assigned rather than mock.method(): the Prisma delegate is a proxy that mock.method cannot inspect.
  delegate.updateMany = async (args: { where?: { id?: string } }) => {
    if (args?.where?.id !== orderId) return original(args)
    arrived += 1
    if (arrived === expected) {
      await onRelease?.()
      release()
    }
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`only ${arrived} of ${expected} payments reached the balance write`)), 5_000)
    })
    try {
      await Promise.race([released, timeout])
    } finally {
      clearTimeout(timer)
    }
    return original(args)
  }
  return {
    arrived: () => arrived,
    restore: () => {
      delegate.updateMany = original
    },
  }
}

test('two payments that both read the same balance: one is recorded, the other changes nothing', async () => {
  const inv = await openInvoice()
  const hold = holdBalanceWrites(inv.orderId, 2)
  let responses: Response[]
  try {
    // One through each endpoint; both are $30 against $51.04, so only one can fit.
    responses = await Promise.all([
      post(`/invoices/${inv.invoiceId}/payments`, { amount: 30, method: 'CHECK', reference: 'chk-a' }),
      post(`/orders/${inv.orderId}/payments`, { amount: 30, method: 'CHECK', reference: 'chk-b' }),
    ])
  } finally {
    hold.restore()
  }
  assert.equal(hold.arrived(), 2, 'both payments read the balance before either wrote')
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409])
  const loser = responses.find((r) => r.status === 409)!
  assert.match(((await loser.json()) as { message: string }).message, /balance changed/)

  await untilNotified(inv, 1)
  assert.deepEqual(await effects(inv), {
    orderPaid: '30.00', invoicePaid: '30.00', invoiceStatus: 'PARTIALLY_PAID', creditUsed: '21.04',
    journalAmounts: ['30.00'], events: 1, notifications: 1, cardIntents: 0,
  })
})

test('a total that changes after the balance check (a credit memo) also stops the payment', async () => {
  const inv = await openInvoice()
  // Between the read and the write, the order total drops to $40 and no payment has been made.
  const hold = holdBalanceWrites(inv.orderId, 1, () =>
    orderDb.order.update({ where: { id: inv.orderId }, data: { totalAmount: '40.00' } }),
  )
  let res: Response
  try {
    res = await post(`/orders/${inv.orderId}/payments`, { amount: 45, method: 'CASH' })
  } finally {
    hold.restore()
  }
  assert.equal(res.status, 409)
  const after = await effects(inv)
  assert.equal(after.orderPaid, '0.00')
  assert.deepEqual(after.journalAmounts, [])
  assert.equal(after.creditUsed, '51.04')
  assert.equal(after.events, 0)
  assert.equal(after.notifications, 0)
})

test('card payments: invalid amounts are rejected before any card charge is attempted', async () => {
  const inv = await openInvoice()
  const before = await effects(inv)
  for (const [label, amount, message] of INVALID) {
    if (amount === undefined || amount === null) continue // no amount means "the whole balance"
    const correlationId = randomUUID()
    const res = await post(`/invoices/${inv.invoiceId}/pay/stripe`, { paymentMethodId: 'pm_card_visa', amount, correlationId })
    assert.equal(res.status, 400, `${label}: status`)
    assert.match(((await res.json()) as { message: string }).message, message, label)
  }
  assert.deepEqual(await effects(inv), before)
  assert.equal(before.cardIntents, 0)
})

test('parsePaymentAmount keeps the amount exactly as entered', () => {
  assert.equal(parsePaymentAmount(0.1).toString(), '0.1')
  assert.equal(parsePaymentAmount(51.04).toFixed(2), '51.04')
  assert.equal(parsePaymentAmount(' 25.5 ').toFixed(2), '25.50')
  assert.equal(parsePaymentAmount('0.01').toFixed(2), '0.01')
  assert.equal(parsePaymentAmount('100').toFixed(2), '100.00')
})

/** The PENDING card payment record a request leaves when it passes validation and stops at "Stripe not connected". */
async function cardAttempt(inv: Inv, amount: unknown) {
  const body: Record<string, unknown> = { paymentMethodId: 'pm_card_visa', correlationId: randomUUID() }
  if (amount !== undefined) body.amount = amount
  const res = await post(`/invoices/${inv.invoiceId}/pay/stripe`, body)
  const intents = await paymentDb.paymentIntent.findMany({ where: { tenantId, orderId: inv.orderId }, orderBy: { createdAt: 'desc' } })
  return { status: res.status, message: ((await res.json()) as { message: string }).message, charged: intents[0]?.amount.toFixed(2) }
}

for (const route of ['invoice', 'order'] as const) {
  test(`${route} payments: one cent pays off a one-cent balance; two cents is too much`, async () => {
    const inv = await openInvoice('0.01')
    const path = route === 'invoice' ? `/invoices/${inv.invoiceId}/payments` : `/orders/${inv.orderId}/payments`

    const over = await post(path, { amount: 0.02, method: 'CASH' })
    assert.equal(over.status, 400)
    assert.match(((await over.json()) as { message: string }).message, /Payment of \$0\.02 is more than the remaining balance of \$0\.01/)
    assert.equal((await effects(inv)).orderPaid, '0.00')

    const cent = await post(path, { amount: '0.01', method: 'CASH' })
    assert.equal(cent.status, 200)
    await untilNotified(inv, 1)
    const paid = await effects(inv)
    assert.deepEqual(paid, {
      orderPaid: '0.01', invoicePaid: '0.01', invoiceStatus: 'PAID', creditUsed: '0.00',
      journalAmounts: ['0.01'], events: 1, notifications: 1, cardIntents: 0,
    })

    // Nothing is owed now: any positive payment is refused, through every endpoint.
    for (const [p, message] of [
      [`/invoices/${inv.invoiceId}/payments`, /already paid/],
      [`/orders/${inv.orderId}/payments`, /already fully paid/],
    ] as const) {
      const res = await post(p, { amount: 0.01, method: 'CASH' })
      assert.equal(res.status, 400)
      assert.match(((await res.json()) as { message: string }).message, message)
    }
    const card = await cardAttempt(inv, 0.01)
    assert.equal(card.status, 400)
    assert.match(card.message, /already paid/)
    assert.deepEqual(await effects(inv), paid)
  })
}

test('a positive payment against an invoice with nothing owed is refused', async () => {
  const inv = await openInvoice('0.00')
  for (const [p, message] of [
    [`/invoices/${inv.invoiceId}/payments`, /already paid/],
    [`/orders/${inv.orderId}/payments`, /already fully paid/],
  ] as const) {
    const res = await post(p, { amount: 5, method: 'CASH' })
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { message: string }).message, message)
  }
  const after = await effects(inv)
  assert.equal(after.orderPaid, '0.00')
  assert.deepEqual(after.journalAmounts, [])
})

test('a one-cent remainder stays open: partially paid, with a one-cent balance', async () => {
  const inv = await openInvoice()
  assert.equal((await post(`/invoices/${inv.invoiceId}/payments`, { amount: 51.03, method: 'CHECK' })).status, 200)
  const invoice = await (
    await handleApiRequest(new Request(`http://localhost/api/v1/invoices/${inv.invoiceId}`, { headers: { Authorization: `Bearer ${accountantToken}` } }))
  ).json() as { balance: number; displayStatus: string; status: string }
  assert.equal(invoice.balance, 0.01)
  assert.equal(invoice.displayStatus, 'PARTIALLY_PAID')
  assert.equal(invoice.status, 'PARTIALLY_PAID')
  // ...and the last cent can still be paid.
  assert.equal((await post(`/invoices/${inv.invoiceId}/payments`, { amount: 0.01, method: 'CHECK' })).status, 200)
  assert.equal((await effects(inv)).invoiceStatus, 'PAID')
})

test('card payments: an omitted amount means the whole balance; an explicit invalid one is refused', async () => {
  const inv = await openInvoice()
  // Passing validation, a request stops at the missing Stripe connection (402) having recorded what it would charge.
  const omitted = await cardAttempt(inv, undefined)
  assert.equal(omitted.status, 402)
  assert.match(omitted.message, /not connected Stripe/)
  assert.equal(omitted.charged, '51.04')
  assert.equal((await cardAttempt(inv, null)).charged, '51.04')
  assert.equal((await cardAttempt(inv, '20.00')).charged, '20.00')
  const before = await paymentDb.paymentIntent.count({ where: { tenantId, orderId: inv.orderId } })
  for (const amount of ['', 0, -1, '10abc', 51.05]) {
    const res = await cardAttempt(inv, amount)
    assert.equal(res.status, 400, JSON.stringify(amount))
  }
  assert.equal(await paymentDb.paymentIntent.count({ where: { tenantId, orderId: inv.orderId } }), before)

  const cent = await openInvoice('0.01')
  const ok = await cardAttempt(cent, 0.01)
  assert.equal(ok.status, 402, 'one cent against a one-cent balance gets as far as Stripe')
  assert.equal(ok.charged, '0.01')
  assert.equal((await cardAttempt(cent, 0.02)).status, 400)
})
