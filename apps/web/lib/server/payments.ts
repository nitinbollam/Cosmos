import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-payment'
import { paymentDb } from './db'
import { ApiError } from './session'
import * as stripe from './stripe'
import { applyCapturedPayment, linkPaymentIntent } from './order-payment-sync'

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
    webhookSigningSecretConfigured: stripe.isWebhookSecretConfigured(),
    rotation:
      'Create a new signing secret in Stripe Dashboard → Webhooks → endpoint → Reveal; update STRIPE_WEBHOOK_SECRET (e.g. via External Secrets) and roll out; then remove the old secret in Stripe.',
  }
}

export async function authorize(tenantId: string, dto: AuthorizeInput) {
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

  const result =
    dto.paymentMethod === 'ACH'
      ? await stripe.processAchPayment(dto.amount, dto.paymentMethodId, dto.customerId)
      : await stripe.authorizePayment(dto.amount, dto.currency, dto.customerId, dto.paymentMethodId)

  if (!result.success) {
    await paymentDb.paymentIntent.update({
      where: { id: intent.id },
      data: { status: 'FAILED', failureReason: result.error },
    })
    throw new ApiError(400, result.error ?? 'Payment authorization failed')
  }

  const updated = await paymentDb.paymentIntent.update({
    where: { id: intent.id },
    data: { status: 'AUTHORIZED', stripeIntentId: result.paymentIntentId },
  })

  await linkPaymentIntent(tenantId, dto.orderId, updated.id)

  return {
    paymentIntentId: updated.id,
    stripeIntentId: result.paymentIntentId,
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
    const r = await stripe.capturePayment(intent.stripeIntentId)
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
  if (intent.stripeIntentId) await stripe.voidPayment(intent.stripeIntentId)
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
    const r = await stripe.refundPayment(intent.stripeIntentId, amount)
    if (!r.success) throw new ApiError(400, r.error ?? 'Refund failed')
  }

  const refundAmount = amount ?? Number(intent.amount)
  const updated = await paymentDb.paymentIntent.update({
    where: { id: paymentIntentId },
    data: {
      refundedAmount: { increment: new Prisma.Decimal(refundAmount) },
      status: refundAmount >= Number(intent.amount) ? 'REFUNDED' : 'CAPTURED',
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
 */
export async function handleStripeWebhook(rawBody: Buffer, signature: string) {
  let event: ReturnType<typeof stripe.verifyStripeWebhook>
  try {
    event = stripe.verifyStripeWebhook(rawBody, signature)
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
