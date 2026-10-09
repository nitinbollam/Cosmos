import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-payment'
import { orderDb, paymentDb } from './db'
import { ApiError } from './session'
import * as stripe from './stripe'
import { resolveStripeCustomerId } from './stripe-customer-sync'
import { applyCapturedPayment, defersFulfillmentUntilPayment, linkPaymentIntent } from './order-payment-sync'
import { requireStripeConnectContext, findTenantIdByConnectedAccount } from './tenant-stripe-connect'
import { isConnectWebhookSecretConfigured } from './stripe-connect'

export type AuthorizeInput = {
  orderId: string
  amount: number
  currency: string
  paymentMethod: string
  customerId: string
  paymentMethodId?: string
  correlationId: string
}

export function stripeIntegrationStatus() {
  return {
    secretKeyConfigured: stripe.isStripeConfigured(),
    webhookSigningSecretConfigured: stripe.isWebhookSecretConfigured(),
    connectWebhookSigningSecretConfigured: isConnectWebhookSecretConfigured(),
    rotation:
      'Create a new signing secret in Stripe Dashboard → Webhooks → endpoint → Reveal; update STRIPE_WEBHOOK_SECRET (platform) or STRIPE_CONNECT_WEBHOOK_SECRET (Connect) and roll out; then remove the old secret in Stripe.',
  }
}

/** Client-facing Stripe.js config for the current tenant's connected account. */
export async function stripeClientConfig(tenantId: string) {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? ''
  const connectCtx = await requireStripeConnectContext(tenantId).catch((e) => {
    if (e instanceof ApiError && e.status === 402) return null
    throw e
  })
  return {
    publishableKey,
    stripeAccount: connectCtx?.connectedAccountId ?? null,
    chargesEnabled: Boolean(connectCtx),
  }
}

export async function authorize(tenantId: string, dto: AuthorizeInput) {
  const order = await orderDb.order.findFirst({ where: { id: dto.orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.customerId !== dto.customerId) {
    throw new ApiError(403, 'Payment customer does not match order')
  }
  if (order.paymentMethod !== dto.paymentMethod) {
    throw new ApiError(400, 'Payment method does not match order')
  }
  if (defersFulfillmentUntilPayment(order.paymentMethod) && order.status !== 'PENDING') {
    throw new ApiError(400, `Order cannot accept payment in status ${order.status}`)
  }
  const orderTotal = Number(order.totalAmount)
  if (dto.amount > orderTotal + 0.01) {
    throw new ApiError(400, 'Payment amount exceeds order total')
  }

  const intent = await paymentDb.paymentIntent.create({
    data: {
      tenantId,
      orderId: dto.orderId,
      amount: new Prisma.Decimal(dto.amount),
      currency: dto.currency,
      paymentMethod: dto.paymentMethod,
      customerId: dto.customerId,
      correlationId: dto.correlationId,
      status: 'PENDING',
      metadata: {},
    },
  })

  if (dto.paymentMethod === 'CASH' || dto.paymentMethod === 'CHECK') {
    const updated = await paymentDb.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'AUTHORIZED' },
    })
    await linkPaymentIntent(tenantId, dto.orderId, updated.id)
    return { paymentIntentId: updated.id, status: updated.status }
  }

  if (!dto.paymentMethodId) {
    throw new ApiError(400, 'paymentMethodId required for card/ACH payments')
  }

  try {
    stripe.assertRealStripePaymentMethodId(dto.paymentMethodId)
  } catch (e) {
    throw new ApiError(400, e instanceof Error ? e.message : 'Invalid payment method')
  }

  const connectCtx = await requireStripeConnectContext(tenantId)
  const stripeCustomerId = await resolveStripeCustomerId(tenantId, dto.customerId)

  const result =
    dto.paymentMethod === 'ACH'
      ? await stripe.processAchPayment(connectCtx, dto.amount, dto.paymentMethodId, stripeCustomerId)
      : await stripe.authorizePayment(
          connectCtx,
          dto.amount,
          dto.currency,
          stripeCustomerId,
          dto.paymentMethodId,
        )

  if (!result.success) {
    await paymentDb.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: result.requiresAction ? 'PENDING' : 'FAILED',
        failureReason: result.error,
        ...(result.paymentIntentId ? { stripeIntentId: result.paymentIntentId } : {}),
      },
    })
    if (result.requiresAction && result.clientSecret) {
      return {
        paymentIntentId: intent.id,
        stripeIntentId: result.paymentIntentId,
        status: 'PENDING',
        requiresAction: true as const,
        clientSecret: result.clientSecret,
      }
    }
    if (defersFulfillmentUntilPayment(order.paymentMethod) && order.status === 'PENDING') {
      await orderDb.order.update({
        where: { id: dto.orderId },
        data: {
          status: 'FAILED',
          failureReason: result.error ?? 'Payment authorization failed',
        },
      })
    }
    throw new ApiError(400, result.error ?? 'Payment authorization failed')
  }

  const updated = await paymentDb.paymentIntent.update({
    where: { id: intent.id },
    data: { status: 'AUTHORIZED', stripeIntentId: result.paymentIntentId },
  })

  await linkPaymentIntent(tenantId, dto.orderId, updated.id)

  if (defersFulfillmentUntilPayment(order.paymentMethod)) {
    const { runOrderFulfillmentPipeline } = await import('./order-orchestration')
    const notifyTriggers = await import('./notification-triggers')
    void runOrderFulfillmentPipeline(dto.orderId, tenantId, dto.correlationId).catch(() => undefined)
    void notifyTriggers.notifyOrderCreated(tenantId, dto.orderId, dto.customerId, orderTotal).catch(() => undefined)
  }

  return {
    paymentIntentId: updated.id,
    stripeIntentId: result.paymentIntentId,
    status: updated.status,
  }
}

/** Complete a card payment after client-side 3DS (confirmCardPayment). */
export async function completeCardAuthorization(
  tenantId: string,
  paymentIntentId: string,
  correlationId: string,
  opts?: { buyerCustomerId?: string },
) {
  const intent = await paymentDb.paymentIntent.findFirst({ where: { id: paymentIntentId, tenantId } })
  if (!intent) throw new ApiError(404, 'Payment intent not found')
  if (opts?.buyerCustomerId && intent.customerId !== opts.buyerCustomerId) {
    throw new ApiError(403, 'Forbidden')
  }
  if (!intent.stripeIntentId) throw new ApiError(400, 'No Stripe payment linked')

  const order = await orderDb.order.findFirst({ where: { id: intent.orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')

  const connectCtx = await requireStripeConnectContext(tenantId)
  const retrieved = await stripe.retrievePaymentIntent(connectCtx, intent.stripeIntentId)
  if (retrieved.status === 'requires_action') {
    throw new ApiError(400, 'Payment still requires authentication')
  }
  if (retrieved.status !== 'requires_capture' && retrieved.status !== 'succeeded') {
    throw new ApiError(400, `Cannot complete payment in status ${retrieved.status}`)
  }

  const isAlreadySucceeded = retrieved.status === 'succeeded'
  const nextStatus = isAlreadySucceeded ? 'CAPTURED' : 'AUTHORIZED'

  const updated = await paymentDb.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: nextStatus,
      capturedAmount: isAlreadySucceeded ? intent.amount : intent.capturedAmount,
      failureReason: null,
    },
  })

  await linkPaymentIntent(tenantId, intent.orderId, updated.id)

  if (isAlreadySucceeded) {
    await applyCapturedPayment(tenantId, intent.orderId, Number(intent.amount))
    const { syncInvoiceFromOrder } = await import('./invoices')
    await syncInvoiceFromOrder(tenantId, intent.orderId).catch(() => undefined)
  }

  if (defersFulfillmentUntilPayment(order.paymentMethod)) {
    const { runOrderFulfillmentPipeline } = await import('./order-orchestration')
    const notifyTriggers = await import('./notification-triggers')
    void runOrderFulfillmentPipeline(intent.orderId, tenantId, correlationId).catch(() => undefined)
    void notifyTriggers
      .notifyOrderCreated(tenantId, intent.orderId, order.customerId, Number(order.totalAmount))
      .catch(() => undefined)
  }

  return {
    paymentIntentId: updated.id,
    stripeIntentId: intent.stripeIntentId,
    status: updated.status,
  }
}

/**
 * A capture is a *payment receipt*, not a sale — revenue is recognized once, by the
 * invoice journal at ship time. This posts Dr Cash / Cr AR in the payment ledger and
 * mirrors it to the main GL.
 */
async function recordPaymentReceived(
  tenantId: string,
  amount: number,
  orderId: string,
  correlationId: string,
) {
  const entryGroupId = randomUUID()
  await paymentDb.$transaction([
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '1000',
        accountType: 'ASSET',
        debit: new Prisma.Decimal(amount),
        credit: new Prisma.Decimal(0),
        description: `Payment received - Order ${orderId}`,
        referenceId: orderId,
        referenceType: 'ORDER',
        correlationId,
      },
    }),
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '1200',
        accountType: 'ASSET',
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(amount),
        description: `AR settled - Order ${orderId}`,
        referenceId: orderId,
        referenceType: 'ORDER',
        correlationId,
      },
    }),
  ])

  const { postArPaymentJournal } = await import('./operations-gl')
  await postArPaymentJournal(tenantId, orderId, amount).catch((err) =>
    console.error(`[gl] AR payment journal failed for order ${orderId}:`, err),
  )
}

/** Refund reverses the cash receipt: Dr AR / Cr Cash. Revenue reverses via credit memo. */
async function recordRefund(tenantId: string, amount: number, orderId: string, correlationId: string) {
  const entryGroupId = randomUUID()
  await paymentDb.$transaction([
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '1200',
        accountType: 'ASSET',
        debit: new Prisma.Decimal(amount),
        credit: new Prisma.Decimal(0),
        description: `Refund (AR restored) - ${orderId}`,
        referenceId: orderId,
        referenceType: 'REFUND',
        correlationId,
      },
    }),
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '1000',
        accountType: 'ASSET',
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(amount),
        description: `Refund (cash out) - ${orderId}`,
        referenceId: orderId,
        referenceType: 'REFUND',
        correlationId,
      },
    }),
  ])

  const { postArRefundJournal } = await import('./operations-gl')
  await postArRefundJournal(tenantId, orderId, amount).catch((err) =>
    console.error(`[gl] AR refund journal failed for order ${orderId}:`, err),
  )
}

export async function capture(tenantId: string, paymentIntentId: string, correlationId: string) {
  const intent = await paymentDb.paymentIntent.findFirst({ where: { id: paymentIntentId, tenantId } })
  if (!intent) throw new ApiError(404, 'Payment intent not found')
  if (intent.status !== 'AUTHORIZED') {
    throw new ApiError(400, `Cannot capture status ${intent.status}`)
  }

  if (intent.stripeIntentId) {
    const connectCtx = await requireStripeConnectContext(tenantId)
    const r = await stripe.capturePayment(connectCtx, intent.stripeIntentId)
    if (!r.success) throw new ApiError(400, r.error ?? 'Capture failed')
  }

  const updated = await paymentDb.paymentIntent.update({
    where: { id: paymentIntentId },
    data: { status: 'CAPTURED', capturedAmount: intent.amount },
  })

  await recordPaymentReceived(tenantId, Number(intent.amount), intent.orderId, correlationId)
  await applyCapturedPayment(tenantId, intent.orderId, Number(intent.amount))
  await linkPaymentIntent(tenantId, intent.orderId, paymentIntentId)
  return { paymentIntentId: updated.id, status: updated.status }
}

export async function voidIntent(tenantId: string, paymentIntentId: string, _correlationId: string) {
  const intent = await paymentDb.paymentIntent.findFirst({ where: { id: paymentIntentId, tenantId } })
  if (!intent) throw new ApiError(404, 'Payment intent not found')
  if (intent.stripeIntentId) {
    const connectCtx = await requireStripeConnectContext(tenantId)
    await stripe.voidPayment(connectCtx, intent.stripeIntentId)
  }
  const updated = await paymentDb.paymentIntent.update({
    where: { id: paymentIntentId },
    data: { status: 'VOIDED' },
  })
  return { paymentIntentId: updated.id, status: updated.status }
}

export async function refund(
  tenantId: string,
  paymentIntentId: string,
  amount: number | undefined,
  correlationId: string,
) {
  const intent = await paymentDb.paymentIntent.findFirst({ where: { id: paymentIntentId, tenantId } })
  if (!intent) throw new ApiError(404, 'Payment intent not found')
  if (intent.status !== 'CAPTURED') {
    throw new ApiError(400, `Cannot refund status ${intent.status}`)
  }

  if (intent.stripeIntentId) {
    const connectCtx = await requireStripeConnectContext(tenantId)
    const r = await stripe.refundPayment(connectCtx, intent.stripeIntentId, amount)
    if (!r.success) throw new ApiError(400, r.error ?? 'Refund failed')
  }

  const refundAmount = amount ?? Number(intent.amount)
  const updated = await paymentDb.paymentIntent.update({
    where: { id: paymentIntentId },
    data: {
      refundedAmount: { increment: new Prisma.Decimal(refundAmount) },
      status:
        Number(intent.refundedAmount) + refundAmount >= Number(intent.capturedAmount ?? intent.amount) - 0.001
          ? 'REFUNDED'
          : 'CAPTURED',
    },
  })

  await recordRefund(tenantId, refundAmount, intent.orderId, correlationId)
  return {
    paymentIntentId: updated.id,
    refundedAmount: Number(updated.refundedAmount),
    status: updated.status,
  }
}

/**
 * Verify and process Stripe webhook events so async outcomes (ACH settlement,
 * out-of-band captures/refunds, failures) reconcile back into our payment state.
 * Connect payment events (event.account set) use POST /webhooks/stripe/connect instead.
 */
export async function handleStripeWebhook(rawBody: Buffer, signature: string) {
  let event: ReturnType<typeof stripe.verifyStripeWebhook>
  try {
    event = stripe.verifyStripeWebhook(rawBody, signature)
    if (event.account) {
      return {
        received: true as const,
        type: event.type,
        ignored: 'connect_event_use_webhooks_stripe_connect',
      }
    }
  } catch {
    return { received: false as const }
  }

  try {
    const { handleBillingWebhookEvent } = await import('./billing')
    if (await handleBillingWebhookEvent(event)) {
      return { received: true as const, type: event.type }
    }

    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object as { id: string }
        const intent = await paymentDb.paymentIntent.findFirst({
          where: { stripeIntentId: pi.id, status: { in: ['PENDING', 'AUTHORIZED'] } },
        })
        if (intent) {
          await paymentDb.paymentIntent.update({
            where: { id: intent.id },
            data: { status: 'CAPTURED', capturedAmount: intent.amount },
          })
          await recordPaymentReceived(intent.tenantId, Number(intent.amount), intent.orderId, `stripe-${event.id}`)
          await applyCapturedPayment(intent.tenantId, intent.orderId, Number(intent.amount))
          await linkPaymentIntent(intent.tenantId, intent.orderId, intent.id)
        }
        break
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as { id: string; last_payment_error?: { message?: string } }
        await paymentDb.paymentIntent.updateMany({
          where: { stripeIntentId: pi.id, status: { in: ['PENDING', 'AUTHORIZED'] } },
          data: { status: 'FAILED', failureReason: pi.last_payment_error?.message ?? 'Payment failed' },
        })
        break
      }
      case 'payment_intent.canceled': {
        const pi = event.data.object as { id: string }
        await paymentDb.paymentIntent.updateMany({
          where: { stripeIntentId: pi.id, status: { in: ['PENDING', 'AUTHORIZED'] } },
          data: { status: 'VOIDED' },
        })
        break
      }
      case 'charge.refunded': {
        const charge = event.data.object as { payment_intent?: string | null; amount_refunded?: number }
        const stripeIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null
        if (stripeIntentId) {
          const intent = await paymentDb.paymentIntent.findFirst({
            where: { stripeIntentId, status: { in: ['CAPTURED', 'REFUNDED'] } },
          })
          if (intent) {
            const refundedTotal = (charge.amount_refunded ?? 0) / 100
            const alreadyRecorded = Number(intent.refundedAmount ?? 0)
            const delta = +(refundedTotal - alreadyRecorded).toFixed(2)
            if (delta > 0.009) {
              await paymentDb.paymentIntent.update({
                where: { id: intent.id },
                data: {
                  refundedAmount: new Prisma.Decimal(refundedTotal),
                  status: refundedTotal >= Number(intent.amount) ? 'REFUNDED' : 'CAPTURED',
                },
              })
              await recordRefund(intent.tenantId, delta, intent.orderId, `stripe-${event.id}`)
            }
          }
        }
        break
      }
      default:
        break
    }
  } catch (err) {
    console.error(`[stripe] webhook processing failed for event ${event.id} (${event.type}):`, err)
    // Return received so Stripe does not retry forever on poison events; the
    // failure is logged for investigation.
  }

  return { received: true as const, type: event.type }
}

/** Connect webhook payment_intent.* → sync Cosmos payment records (resolve tenant via event.account). */
export async function syncConnectPaymentIntentEvent(event: import('stripe').Stripe.Event) {
  const accountId = event.account
  if (!accountId) return

  const tenantId = await findTenantIdByConnectedAccount(accountId)
  if (!tenantId) {
    console.warn('[stripe connect webhook] unknown connected account', accountId, event.type)
    return
  }

  await syncStripeWebhookEvent(event, tenantId)
}

async function syncStripeWebhookEvent(event: import('stripe').Stripe.Event, _tenantId?: string) {
  const pi =
    event.type === 'payment_intent.succeeded' ||
    event.type === 'payment_intent.payment_failed' ||
    event.type === 'payment_intent.canceled'
      ? (event.data.object as import('stripe').Stripe.PaymentIntent)
      : event.type === 'charge.refunded'
        ? ((event.data.object as import('stripe').Stripe.Charge).payment_intent as string | null)
        : null

  let stripeIntentId: string | null = null
  if (typeof pi === 'string') stripeIntentId = pi
  else if (pi && typeof pi === 'object' && 'id' in pi) stripeIntentId = pi.id

  if (!stripeIntentId) return

  const intent = await paymentDb.paymentIntent.findFirst({ where: { stripeIntentId } })
  if (!intent) return

  if (_tenantId && intent.tenantId !== _tenantId) {
    console.warn('[stripe connect webhook] tenant mismatch for', stripeIntentId)
    return
  }

  if (event.type === 'payment_intent.succeeded') {
    const obj = event.data.object as import('stripe').Stripe.PaymentIntent
    if (obj.status === 'succeeded' && intent.status === 'PENDING') {
      await paymentDb.paymentIntent.update({
        where: { id: intent.id },
        data: { status: 'CAPTURED', capturedAmount: intent.amount },
      })
      await applyCapturedPayment(intent.tenantId, intent.orderId, Number(intent.amount))
    }
  } else if (event.type === 'payment_intent.payment_failed') {
    const obj = event.data.object as import('stripe').Stripe.PaymentIntent
    await paymentDb.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'FAILED',
        failureReason: obj.last_payment_error?.message ?? 'Payment failed',
      },
    })
  } else if (event.type === 'payment_intent.canceled' && intent.status === 'AUTHORIZED') {
    await paymentDb.paymentIntent.update({ where: { id: intent.id }, data: { status: 'VOIDED' } })
  }
}
