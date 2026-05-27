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

async function recordSale(
  tenantId: string,
  amount: number,
  taxAmount: number,
  orderId: string,
  correlationId: string,
) {
  const entryGroupId = randomUUID()
  await paymentDb.$transaction([
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '1100',
        accountType: 'ASSET',
        debit: new Prisma.Decimal(amount + taxAmount),
        credit: new Prisma.Decimal(0),
        description: `Sale - Order ${orderId}`,
        referenceId: orderId,
        referenceType: 'ORDER',
        correlationId,
      },
    }),
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '4000',
        accountType: 'REVENUE',
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(amount),
        description: `Revenue - Order ${orderId}`,
        referenceId: orderId,
        referenceType: 'ORDER',
        correlationId,
      },
    }),
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '2200',
        accountType: 'LIABILITY',
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(taxAmount),
        description: `Sales Tax - Order ${orderId}`,
        referenceId: orderId,
        referenceType: 'ORDER',
        correlationId,
      },
    }),
  ])
}

async function recordRefund(tenantId: string, amount: number, orderId: string, correlationId: string) {
  const entryGroupId = randomUUID()
  await paymentDb.$transaction([
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '4000',
        accountType: 'REVENUE',
        debit: new Prisma.Decimal(amount),
        credit: new Prisma.Decimal(0),
        description: `Refund (revenue reversal) - ${orderId}`,
        referenceId: orderId,
        referenceType: 'REFUND',
        correlationId,
      },
    }),
    paymentDb.ledgerEntry.create({
      data: {
        tenantId,
        entryGroupId,
        accountCode: '1100',
        accountType: 'ASSET',
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(amount),
        description: `Refund (AR reduction) - ${orderId}`,
        referenceId: orderId,
        referenceType: 'REFUND',
        correlationId,
      },
    }),
  ])
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

  await recordSale(tenantId, Number(intent.amount), 0, intent.orderId, correlationId)
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

export function handleStripeWebhook(rawBody: Buffer, signature: string) {
  try {
    const event = stripe.verifyStripeWebhook(rawBody, signature)
    return { received: true, type: event.type }
  } catch {
    return { received: false }
  }
}
