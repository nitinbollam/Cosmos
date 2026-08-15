import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-payment'
import { orderDb, paymentDb } from './db'
import { ApiError } from './session'
import * as payments from './payments'
import { syncInvoiceFromOrder } from './invoices'
import { resolveStripeCustomerId } from './stripe-customer-sync'
import * as stripe from './stripe'
import { applyCapturedPayment, linkPaymentIntent } from './order-payment-sync'
import { requireStripeConnectContext } from './tenant-stripe-connect'
import { stripeConnectDashboardPaymentUrl } from './stripe-connect'

export type OrderPaymentSummary = {
  paymentIntentId: string | null
  stripeIntentId: string | null
  stripeConnectedAccountId: string | null
  stripeDashboardPaymentUrl: string | null
  paymentStatus: string | null
  paymentAmount: number | null
  capturedAmount: number | null
  refundedAmount: number
  refundableAmount: number
  paymentFailureReason: string | null
  amountPaidOnOrder: number
  orderBalance: number
}

export async function findPrimaryPaymentIntent(tenantId: string, orderId: string, linkedId?: string | null) {
  if (linkedId) {
    const linked = await paymentDb.paymentIntent.findFirst({ where: { id: linkedId, tenantId, orderId } })
    if (linked) return linked
  }
  return paymentDb.paymentIntent.findFirst({
    where: { tenantId, orderId },
    orderBy: { createdAt: 'desc' },
  })
}

export function buildPaymentSummary(
  order: { totalAmount: unknown; amountPaid: unknown },
  intent: {
    id: string
    stripeIntentId: string | null
    status: string
    amount: unknown
    capturedAmount: unknown | null
    refundedAmount: unknown
    failureReason: string | null
  } | null,
  connect?: { stripeConnectedAccountId: string | null },
): OrderPaymentSummary {
  const total = Number(order.totalAmount)
  const amountPaidOnOrder = Number(order.amountPaid ?? 0)
  const captured = intent ? Number(intent.capturedAmount ?? intent.amount) : 0
  const refunded = intent ? Number(intent.refundedAmount ?? 0) : 0
  const refundableAmount =
    intent?.status === 'CAPTURED' || intent?.status === 'REFUNDED'
      ? Math.max(0, captured - refunded)
      : 0

  const acct = connect?.stripeConnectedAccountId ?? null
  const pi = intent?.stripeIntentId ?? null

  return {
    paymentIntentId: intent?.id ?? null,
    stripeIntentId: pi,
    stripeConnectedAccountId: acct,
    stripeDashboardPaymentUrl:
      acct && pi ? stripeConnectDashboardPaymentUrl(acct, pi) : null,
    paymentStatus: intent?.status ?? null,
    paymentAmount: intent ? Number(intent.amount) : null,
    capturedAmount: intent?.capturedAmount != null ? Number(intent.capturedAmount) : null,
    refundedAmount: refunded,
    refundableAmount,
    paymentFailureReason: intent?.failureReason ?? null,
    amountPaidOnOrder,
    orderBalance: Math.max(0, +(total - amountPaidOnOrder).toFixed(2)),
  }
}

export async function getOrderPaymentSummary(
  tenantId: string,
  orderId: string,
  linkedPaymentIntentId?: string | null,
): Promise<OrderPaymentSummary> {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  const intent = await findPrimaryPaymentIntent(tenantId, orderId, linkedPaymentIntentId)
  const { optionalStripeConnectContext } = await import('./tenant-stripe-connect')
  const connectCtx = await optionalStripeConnectContext(tenantId)
  return buildPaymentSummary(order, intent, {
    stripeConnectedAccountId: connectCtx?.connectedAccountId ?? null,
  })
}

function orderCollectableBalance(order: { totalAmount: unknown; amountPaid: unknown }, amount?: number): number {
  const balance = Math.max(0, Number(order.totalAmount) - Number(order.amountPaid ?? 0))
  if (amount == null) return balance
  if (amount <= 0) throw new ApiError(400, 'Invalid payment amount')
  if (amount > balance + 0.01) throw new ApiError(400, 'Payment amount exceeds order balance')
  return amount
}

export async function collectOrderCardPayment(
  tenantId: string,
  orderId: string,
  body: { paymentMethodId: string; amount?: number; correlationId: string; customerId: string },
) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.customerId !== body.customerId) throw new ApiError(403, 'Customer does not match order')

  const collectAmount = orderCollectableBalance(order, body.amount)
  if (collectAmount <= 0.01) throw new ApiError(400, 'Order has no balance due')

  const intent = await paymentDb.paymentIntent.create({
    data: {
      tenantId,
      orderId,
      amount: new Prisma.Decimal(collectAmount),
      currency: 'USD',
      paymentMethod: 'CARD',
      customerId: body.customerId,
      correlationId: body.correlationId,
      status: 'PENDING',
      metadata: { source: 'admin_collect' },
    },
  })

  const connectCtx = await requireStripeConnectContext(tenantId)
  const stripeCustomerId = await resolveStripeCustomerId(tenantId, body.customerId)
  const result = await stripe.chargePaymentMethod(
    connectCtx,
    collectAmount,
    'usd',
    stripeCustomerId,
    body.paymentMethodId,
  )

  if (result.requiresAction && result.clientSecret) {
    await paymentDb.paymentIntent.update({
      where: { id: intent.id },
      data: { stripeIntentId: result.paymentIntentId, failureReason: 'requires_action' },
    })
    return {
      paymentIntentId: intent.id,
      stripeIntentId: result.paymentIntentId,
      requiresAction: true as const,
      clientSecret: result.clientSecret,
    }
  }

  if (!result.success) {
    await paymentDb.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'FAILED', failureReason: result.error },
    })
    throw new ApiError(400, result.error ?? 'Card payment failed')
  }

  const updated = await paymentDb.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: 'CAPTURED',
      stripeIntentId: result.paymentIntentId,
      capturedAmount: new Prisma.Decimal(collectAmount),
    },
  })

  await linkPaymentIntent(tenantId, orderId, updated.id)
  await applyCapturedPayment(tenantId, orderId, collectAmount)
  await syncInvoiceFromOrder(tenantId, orderId).catch(() => undefined)

  const invoice = await orderDb.invoice.findFirst({ where: { tenantId, orderId } })
  if (invoice) {
    const { postArPaymentJournal } = await import('./operations-gl')
    await postArPaymentJournal(tenantId, invoice.id, collectAmount).catch(() => undefined)
    const { notifyPaymentReceived } = await import('./notification-triggers')
    void notifyPaymentReceived(tenantId, orderId, order.customerId, collectAmount, invoice.invoiceNumber).catch(
      () => undefined,
    )
  }

  return {
    paymentIntentId: updated.id,
    stripeIntentId: result.paymentIntentId,
    status: updated.status,
    amountPaid: collectAmount,
  }
}

/** Finalize admin card collection after client-side 3DS. */
export async function completeOrderCardCollection(
  tenantId: string,
  orderId: string,
  cosmosPaymentIntentId: string,
) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')

  const intent = await paymentDb.paymentIntent.findFirst({
    where: { id: cosmosPaymentIntentId, tenantId, orderId },
  })
  if (!intent?.stripeIntentId) throw new ApiError(400, 'No Stripe payment linked')

  const connectCtx = await requireStripeConnectContext(tenantId)
  const retrieved = await stripe.retrievePaymentIntent(connectCtx, intent.stripeIntentId)
  if (retrieved.status !== 'succeeded') {
    throw new ApiError(400, `Payment not completed (status ${retrieved.status})`)
  }

  const collectAmount = Number(intent.amount)
  const updated = await paymentDb.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: 'CAPTURED',
      capturedAmount: new Prisma.Decimal(collectAmount),
      failureReason: null,
    },
  })

  await linkPaymentIntent(tenantId, orderId, updated.id)
  await applyCapturedPayment(tenantId, orderId, collectAmount)
  await syncInvoiceFromOrder(tenantId, orderId).catch(() => undefined)

  const invoice = await orderDb.invoice.findFirst({ where: { tenantId, orderId } })
  if (invoice) {
    const { postArPaymentJournal } = await import('./operations-gl')
    await postArPaymentJournal(tenantId, invoice.id, collectAmount).catch(() => undefined)
  }

  return { paymentIntentId: updated.id, stripeIntentId: intent.stripeIntentId, status: updated.status }
}

export async function refundOrderPayment(
  tenantId: string,
  orderId: string,
  correlationId: string,
  amount?: number,
) {
  const intent = await findPrimaryPaymentIntent(
    tenantId,
    orderId,
    (await orderDb.order.findFirst({ where: { id: orderId, tenantId } }))?.paymentIntentId,
  )
  if (!intent) throw new ApiError(400, 'No payment found for this order')
  if (intent.status !== 'CAPTURED' && intent.status !== 'REFUNDED') {
    throw new ApiError(400, `Cannot refund payment in status ${intent.status}`)
  }
  const captured = Number(intent.capturedAmount ?? intent.amount)
  const alreadyRefunded = Number(intent.refundedAmount ?? 0)
  const refundable = Math.max(0, captured - alreadyRefunded)
  if (refundable <= 0.01) throw new ApiError(400, 'No refundable balance on this payment')

  const refundAmount = amount != null ? Math.min(amount, refundable) : refundable
  const result = await payments.refund(tenantId, intent.id, refundAmount, correlationId)
  await syncInvoiceFromOrder(tenantId, orderId).catch(() => undefined)
  return result
}

export async function captureOrderPayment(tenantId: string, orderId: string, correlationId: string) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  const intent = await findPrimaryPaymentIntent(tenantId, orderId, order.paymentIntentId)
  if (!intent) throw new ApiError(400, 'No payment authorization found')
  if (intent.status !== 'AUTHORIZED') {
    throw new ApiError(400, `Cannot capture payment in status ${intent.status}`)
  }
  return payments.capture(tenantId, intent.id, correlationId)
}

export async function voidOrderPayment(tenantId: string, orderId: string, correlationId: string) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  const intent = await findPrimaryPaymentIntent(tenantId, orderId, order.paymentIntentId)
  if (!intent) throw new ApiError(400, 'No payment authorization found')
  if (intent.status !== 'AUTHORIZED') {
    throw new ApiError(400, `Cannot void payment in status ${intent.status}`)
  }
  return payments.voidIntent(tenantId, intent.id, correlationId)
}

export async function voidAuthorizedPaymentsForOrder(tenantId: string, orderId: string) {
  const intents = await paymentDb.paymentIntent.findMany({
    where: { tenantId, orderId, status: 'AUTHORIZED' },
  })
  for (const intent of intents) {
    await payments.voidIntent(tenantId, intent.id, randomUUID()).catch(() => undefined)
  }
}
