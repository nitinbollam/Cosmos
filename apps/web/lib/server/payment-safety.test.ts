import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Stripe from 'stripe'
import { Prisma } from '@/generated/prisma-payment'
import { handleApiRequest } from '../../server/api-router'
import { paymentDb } from './db'
import { capture, completeCardAuthorization, confirmTransition, refund, voidIntent } from './payments'
import { processStripeEventOnce } from './stripe-webhook-events'

const tenantId = `t-${randomUUID()}`
const eventIds: string[] = []

after(async () => {
  await paymentDb.ledgerEntry.deleteMany({ where: { tenantId } })
  await paymentDb.paymentIntent.deleteMany({ where: { tenantId } })
  await paymentDb.stripeWebhookEvent.deleteMany({ where: { id: { in: eventIds } } })
})

/** A card payment with no Stripe link, so these tests exercise only Pleros's own bookkeeping. */
async function payment(status: 'AUTHORIZED' | 'CAPTURED', extra: { stripeIntentId?: string } = {}) {
  return paymentDb.paymentIntent.create({
    data: {
      tenantId,
      orderId: `o-${randomUUID()}`,
      amount: new Prisma.Decimal(100),
      paymentMethod: 'CARD',
      customerId: 'c-1',
      correlationId: randomUUID(),
      metadata: {},
      status,
      capturedAmount: status === 'CAPTURED' ? new Prisma.Decimal(100) : null,
      ...extra,
    },
  })
}

/** How many refund / payment-received postings the ledger holds for an order. */
async function postings(orderId: string, description: string) {
  const rows = await paymentDb.ledgerEntry.findMany({ where: { tenantId, referenceId: orderId } })
  return new Set(rows.filter((r) => r.description?.startsWith(description)).map((r) => r.entryGroupId)).size
}

test('two refunds of one payment at the same moment refund it once', async () => {
  const p = await payment('CAPTURED')
  const results = await Promise.allSettled([refund(tenantId, p.id, 40, 'a'), refund(tenantId, p.id, 40, 'b')])

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
  assert.equal((failed.reason as { status: number }).status, 409)
  const after = await paymentDb.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })
  assert.equal(Number(after.refundedAmount), 40)
  assert.equal(await postings(p.orderId, 'Refund'), 1)
})

test('refunds can never add up to more than was captured', async () => {
  const p = await payment('CAPTURED')
  await refund(tenantId, p.id, 60, 'a')
  await assert.rejects(refund(tenantId, p.id, 60, 'b'), { status: 400 })
  // No amount means "the rest" (40), not the original 100.
  const rest = await refund(tenantId, p.id, undefined, 'c')
  assert.equal(rest.refundedAmount, 100)
  assert.equal(rest.status, 'REFUNDED')
  await assert.rejects(refund(tenantId, p.id, 1, 'd'), { status: 400 })
})

test('two captures at the same moment record the payment once', async () => {
  const p = await payment('AUTHORIZED')
  const results = await Promise.allSettled([capture(tenantId, p.id, 'a'), capture(tenantId, p.id, 'b')])

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(await postings(p.orderId, 'Payment received'), 1)
})

test('captured money cannot be voided (it has to be refunded)', async () => {
  const p = await payment('CAPTURED')
  await assert.rejects(voidIntent(tenantId, p.id, 'a'), { status: 400 })
  const after = await paymentDb.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })
  assert.equal(after.status, 'CAPTURED')
})

test('when Stripe fails after the claim, the payment is put back exactly as it was', async () => {
  // A Stripe-linked payment on a tenant with no Stripe account: the Stripe step throws.
  const stripeLinked = () => ({ stripeIntentId: `pi_${randomUUID()}` })

  const r = await payment('CAPTURED', stripeLinked())
  await assert.rejects(refund(tenantId, r.id, 40, 'a'))
  const afterRefund = await paymentDb.paymentIntent.findUniqueOrThrow({ where: { id: r.id } })
  assert.equal(Number(afterRefund.refundedAmount), 0)
  assert.equal(afterRefund.status, 'CAPTURED')
  assert.equal(await postings(r.orderId, 'Refund'), 0)

  const c = await payment('AUTHORIZED', stripeLinked())
  await assert.rejects(capture(tenantId, c.id, 'a'))
  const afterCapture = await paymentDb.paymentIntent.findUniqueOrThrow({ where: { id: c.id } })
  assert.equal(afterCapture.status, 'AUTHORIZED')
  assert.equal(afterCapture.capturedAmount, null)
  assert.equal(await postings(c.orderId, 'Payment received'), 0)

  const v = await payment('AUTHORIZED', stripeLinked())
  await assert.rejects(voidIntent(tenantId, v.id, 'a'))
  assert.equal((await paymentDb.paymentIntent.findUniqueOrThrow({ where: { id: v.id } })).status, 'AUTHORIZED')
})

test('confirm only moves a payment forward', () => {
  for (const settled of ['CAPTURED', 'REFUNDED', 'VOIDED']) {
    assert.equal(confirmTransition(settled, 'succeeded'), null, settled)
    assert.equal(confirmTransition(settled, 'requires_capture'), null, settled)
  }
  assert.equal(confirmTransition('PENDING', 'requires_capture'), 'AUTHORIZED')
  assert.equal(confirmTransition('FAILED', 'requires_capture'), 'AUTHORIZED')
  assert.equal(confirmTransition('AUTHORIZED', 'requires_capture'), null)
  assert.equal(confirmTransition('AUTHORIZED', 'succeeded'), 'CAPTURED')
})

test('confirming a refunded payment again leaves it refunded, without asking Stripe', async () => {
  const p = await payment('CAPTURED', { stripeIntentId: `pi_${randomUUID()}` })
  await paymentDb.paymentIntent.update({
    where: { id: p.id },
    data: { status: 'REFUNDED', refundedAmount: new Prisma.Decimal(100) },
  })
  const res = await completeCardAuthorization(tenantId, p.id, 'c')
  assert.equal(res.status, 'REFUNDED')
  const after = await paymentDb.paymentIntent.findUniqueOrThrow({ where: { id: p.id } })
  assert.equal(after.status, 'REFUNDED')
})

function event(type = 'test.event') {
  const id = `evt_${randomUUID()}`
  eventIds.push(id)
  return { id, type }
}

test('a redelivered Stripe event is processed once', async () => {
  const e = event()
  let runs = 0
  assert.equal(await processStripeEventOnce(e, async () => void runs++), 'processed')
  assert.equal(await processStripeEventOnce(e, async () => void runs++), 'duplicate')
  assert.equal(runs, 1)
})

test('a Stripe event that fails is not acknowledged, and the retry processes it', async () => {
  const e = event()
  await assert.rejects(
    processStripeEventOnce(e, async () => {
      throw new Error('database hiccup')
    }),
    /database hiccup/,
  )
  let runs = 0
  assert.equal(await processStripeEventOnce(e, async () => void runs++), 'processed')
  assert.equal(runs, 1)
})

test('a delivery that arrives while the first is still running is told to retry later', async () => {
  const e = event()
  let runs = 0
  const slow = processStripeEventOnce(e, async () => {
    runs++
    await new Promise((r) => setTimeout(r, 50))
  })
  await new Promise((r) => setTimeout(r, 10))
  await assert.rejects(processStripeEventOnce(e, async () => void runs++), { status: 409 })
  assert.equal(await slow, 'processed')
  assert.equal(runs, 1)
})

test('a claim abandoned by a crash is taken over by the next delivery', async () => {
  const e = event()
  await paymentDb.stripeWebhookEvent.create({
    data: { id: e.id, type: e.type, claimedAt: new Date(Date.now() - 10 * 60_000) },
  })
  let runs = 0
  assert.equal(await processStripeEventOnce(e, async () => void runs++), 'processed')
  assert.equal(runs, 1)
})

test('the Connect webhook rejects a bad signature and skips a redelivered event', async () => {
  const prevSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  const prevKey = process.env.STRIPE_SECRET_KEY
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test_connect'
  process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder'
  try {
    const e = event('account.application.authorized')
    const payload = JSON.stringify({ id: e.id, object: 'event', type: e.type, account: 'acct_test', data: { object: {} } })
    const post = (signature: string) =>
      handleApiRequest(
        new Request('http://localhost/api/v1/webhooks/stripe/connect', {
          method: 'POST',
          headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
          body: payload,
        }),
      )
    const signed = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_connect' })

    assert.equal((await post('t=1,v1=forged')).status, 400)
    const first = await post(signed)
    assert.equal(first.status, 200)
    assert.equal(((await first.json()) as { duplicate?: boolean }).duplicate, undefined)
    const again = await post(signed)
    assert.equal(again.status, 200)
    assert.equal(((await again.json()) as { duplicate?: boolean }).duplicate, true)
  } finally {
    if (prevSecret === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = prevSecret
    if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = prevKey
  }
})

test('a card collection captured by Stripe\'s webhook before its completion is booked exactly once', async () => {
  const { orderDb, ledgerDb, tenantDb } = await import('./db')
  const { createChartAccount } = await import('./ledger')
  const { AccountType } = await import('@/generated/prisma-ledger')
  const { completeOrderCardCollection } = await import('./order-payment-admin')

  const t = `t-${randomUUID()}`
  const account = `acct_${randomUUID().slice(0, 12)}`
  const stripeIntentId = `pi_${randomUUID()}`
  await tenantDb.tenantOrganization.create({
    data: { id: t, slug: `race-${t.slice(-8)}`, displayName: 'Race', settings: {}, metadata: {}, stripeConnectedAccountId: account },
  })
  await createChartAccount(t, { code: '1000', name: 'Cash', type: AccountType.ASSET })
  await createChartAccount(t, { code: '1200', name: 'AR', type: AccountType.ASSET })
  const order = await orderDb.order.create({
    data: { tenantId: t, customerId: 'c-1', channel: 'B2B_PORTAL', totalAmount: 100, paymentMethod: 'CARD' },
  })
  await orderDb.invoice.create({
    data: { tenantId: t, orderId: order.id, invoiceNumber: 'INV-RACE', customerId: 'c-1', subtotal: 100, taxAmount: 0, totalAmount: 100 },
  })
  const intent = await paymentDb.paymentIntent.create({
    data: {
      tenantId: t, orderId: order.id, amount: new Prisma.Decimal(100), paymentMethod: 'CARD', customerId: 'c-1',
      correlationId: randomUUID(), metadata: { source: 'admin_collect' }, status: 'PENDING', stripeIntentId,
      failureReason: 'requires_action',
    },
  })
  const arJournals = () =>
    ledgerDb.journalEntry.count({ where: { tenantId: t, description: { startsWith: 'AR payment' } } })

  const prevSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  const prevKey = process.env.STRIPE_SECRET_KEY
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_test_connect'
  process.env.STRIPE_SECRET_KEY ||= 'sk_test_placeholder'
  try {
    const e = event('payment_intent.succeeded')
    const payload = JSON.stringify({
      id: e.id, object: 'event', type: e.type, account,
      data: { object: { id: stripeIntentId, object: 'payment_intent', status: 'succeeded' } },
    })
    const res = await handleApiRequest(
      new Request('http://localhost/api/v1/webhooks/stripe/connect', {
        method: 'POST',
        headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_connect' }) },
        body: payload,
      }),
    )
    assert.equal(res.status, 200)
    assert.equal((await paymentDb.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).status, 'CAPTURED')
    assert.equal(Number((await orderDb.order.findUniqueOrThrow({ where: { id: order.id } })).amountPaid), 100)
    assert.equal(await arJournals(), 1)

    // The admin's 3DS completion arrives second: it finds the payment captured and books nothing more.
    const done = await completeOrderCardCollection(t, order.id, intent.id)
    assert.equal(done.status, 'CAPTURED')
    assert.equal(await arJournals(), 1)
    assert.equal(Number((await orderDb.order.findUniqueOrThrow({ where: { id: order.id } })).amountPaid), 100)
  } finally {
    if (prevSecret === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = prevSecret
    if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = prevKey
    await paymentDb.paymentIntent.deleteMany({ where: { tenantId: t } })
    await ledgerDb.journalLine.deleteMany({ where: { entry: { tenantId: t } } }).catch(() => undefined)
    await ledgerDb.journalEntry.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await ledgerDb.chartAccount.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await orderDb.invoice.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await orderDb.order.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await tenantDb.tenantOrganization.delete({ where: { id: t } }).catch(() => undefined)
  }
})
