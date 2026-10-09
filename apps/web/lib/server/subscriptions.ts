import { randomUUID } from 'node:crypto'
import { SubscriptionInterval, SubscriptionStatus } from '@/generated/prisma-tenant'
import { tenantDb, paymentDb } from './db'
import { ApiError } from './session'
import * as orders from './orders'
import * as savedPaymentMethods from './saved-payment-methods'
import { collectOrderCardPayment } from './order-payment-admin'

export type CreateSubscriptionInput = {
  customerId?: string
  savedPaymentMethodId: string
  interval: SubscriptionInterval
  intervalDays?: number
  lines: Array<{ skuId: string; warehouseId: string; quantity: number }>
}

function advanceDate(from: Date, interval: SubscriptionInterval, intervalDays?: number | null): Date {
  const d = new Date(from)
  switch (interval) {
    case SubscriptionInterval.WEEKLY:
      d.setDate(d.getDate() + 7)
      break
    case SubscriptionInterval.BIWEEKLY:
      d.setDate(d.getDate() + 14)
      break
    case SubscriptionInterval.MONTHLY:
      d.setMonth(d.getMonth() + 1)
      break
    case SubscriptionInterval.CUSTOM_DAYS:
      d.setDate(d.getDate() + Math.max(1, intervalDays ?? 30))
      break
  }
  return d
}

async function assertSavedMethod(tenantId: string, customerId: string, savedPaymentMethodId: string) {
  const methods = await savedPaymentMethods.listSavedPaymentMethods(tenantId, customerId)
  const method = methods.find((m) => m.id === savedPaymentMethodId)
  if (!method) throw new ApiError(400, 'Saved payment method not found for customer')
  return method
}

export async function createSubscription(tenantId: string, input: CreateSubscriptionInput & { customerId: string }) {
  if (!input.lines.length) throw new ApiError(400, 'At least one line required')
  const method = await assertSavedMethod(tenantId, input.customerId, input.savedPaymentMethodId)
  if (input.interval === SubscriptionInterval.CUSTOM_DAYS && (!input.intervalDays || input.intervalDays < 1)) {
    throw new ApiError(400, 'intervalDays required for CUSTOM_DAYS')
  }

  return tenantDb.subscription.create({
    data: {
      tenantId,
      customerId: input.customerId,
      savedPaymentMethodId: method.id,
      interval: input.interval,
      intervalDays: input.intervalDays ?? null,
      nextOrderDate: advanceDate(new Date(), input.interval, input.intervalDays),
      status: SubscriptionStatus.ACTIVE,
      lines: {
        create: input.lines.map((l) => ({
          skuId: l.skuId,
          warehouseId: l.warehouseId,
          quantity: l.quantity,
        })),
      },
    },
    include: { lines: true },
  })
}

export async function listSubscriptions(tenantId: string, customerId?: string) {
  return tenantDb.subscription.findMany({
    where: { tenantId, ...(customerId ? { customerId } : {}) },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getSubscription(tenantId: string, id: string, customerId?: string) {
  const row = await tenantDb.subscription.findFirst({
    where: { id, tenantId, ...(customerId ? { customerId } : {}) },
    include: { lines: true },
  })
  if (!row) throw new ApiError(404, 'Subscription not found')
  return row
}

export async function pauseSubscription(tenantId: string, id: string, customerId?: string) {
  const sub = await getSubscription(tenantId, id, customerId)
  if (sub.status === SubscriptionStatus.CANCELLED) throw new ApiError(400, 'Subscription is cancelled')
  return tenantDb.subscription.update({
    where: { id },
    data: { status: SubscriptionStatus.PAUSED },
    include: { lines: true },
  })
}

export async function resumeSubscription(tenantId: string, id: string, customerId?: string) {
  const sub = await getSubscription(tenantId, id, customerId)
  if (sub.status === SubscriptionStatus.CANCELLED) throw new ApiError(400, 'Subscription is cancelled')
  return tenantDb.subscription.update({
    where: { id },
    data: {
      status: SubscriptionStatus.ACTIVE,
      lastFailureReason: null,
      nextOrderDate: sub.nextOrderDate < new Date() ? new Date() : sub.nextOrderDate,
    },
    include: { lines: true },
  })
}

export async function cancelSubscription(tenantId: string, id: string, customerId?: string) {
  await getSubscription(tenantId, id, customerId)
  return tenantDb.subscription.update({
    where: { id },
    data: { status: SubscriptionStatus.CANCELLED },
    include: { lines: true },
  })
}

export async function updateSubscriptionLines(
  tenantId: string,
  id: string,
  lines: Array<{ skuId: string; warehouseId: string; quantity: number }>,
  customerId?: string,
) {
  const sub = await getSubscription(tenantId, id, customerId)
  if (sub.status === SubscriptionStatus.CANCELLED) throw new ApiError(400, 'Subscription is cancelled')
  if (!lines.length) throw new ApiError(400, 'At least one line required')

  await tenantDb.subscriptionLine.deleteMany({ where: { subscriptionId: id } })
  return tenantDb.subscription.update({
    where: { id },
    data: {
      lines: {
        create: lines.map((l) => ({
          skuId: l.skuId,
          warehouseId: l.warehouseId,
          quantity: l.quantity,
        })),
      },
    },
    include: { lines: true },
  })
}

async function processOneSubscription(sub: Awaited<ReturnType<typeof listSubscriptions>>[number]) {
  const { resolvePricesForCustomer } = await import('./pricing')
  const skuIds = sub.lines.map((l) => l.skuId)
  const prices = await resolvePricesForCustomer(sub.tenantId, sub.customerId, skuIds)

  const order = await orders.createOrder(
    sub.tenantId,
    {
      customerId: sub.customerId,
      channel: 'B2B_PORTAL',
      paymentMethod: 'CARD',
      notes: `Subscription ${sub.id}`,
      lineItems: sub.lines.map((l) => ({
        skuId: l.skuId,
        warehouseId: l.warehouseId,
        quantity: l.quantity,
        unitPrice: prices.get(l.skuId)?.unitPrice ?? 0,
      })),
    },
    { awaitPipeline: true },
  )

  try {
    const saved = await paymentDb.savedPaymentMethod.findFirst({
      where: { id: sub.savedPaymentMethodId, tenantId: sub.tenantId, customerId: sub.customerId },
    })
    if (!saved) throw new ApiError(400, 'Saved payment method missing')

    const correlationId = randomUUID()
    await collectOrderCardPayment(sub.tenantId, order.id, {
      paymentMethodId: saved.stripePaymentMethodId,
      customerId: sub.customerId,
      correlationId,
      amount: Number(order.totalAmount),
    })
  } catch (payErr) {
    const { cancelOrderWithCompensation } = await import('./order-orchestration')
    await cancelOrderWithCompensation(
      sub.tenantId,
      order.id,
      `Subscription payment failed: ${payErr instanceof Error ? payErr.message : 'Declined'}`,
    ).catch(() => undefined)
    throw payErr
  }

  await tenantDb.subscription.update({
    where: { id: sub.id },
    data: {
      nextOrderDate: advanceDate(new Date(), sub.interval, sub.intervalDays),
      lastFailureReason: null,
    },
  })

  const { notifySubscriptionOrderCreated } = await import('./notification-triggers')
  void notifySubscriptionOrderCreated(sub.tenantId, sub.id, order.id, sub.customerId).catch(() => undefined)

  return order
}

export async function processDueSubscriptions(): Promise<{ processed: number; failed: number }> {
  const due = await tenantDb.subscription.findMany({
    where: {
      status: SubscriptionStatus.ACTIVE,
      nextOrderDate: { lte: new Date() },
    },
    include: { lines: true },
  })

  let processed = 0
  let failed = 0

  for (const sub of due) {
    try {
      await processOneSubscription(sub)
      processed += 1
    } catch (err) {
      failed += 1
      const reason = err instanceof Error ? err.message : 'Payment failed'
      await tenantDb.subscription.update({
        where: { id: sub.id },
        data: { status: SubscriptionStatus.PAUSED, lastFailureReason: reason.slice(0, 500) },
      })
      const { notifySubscriptionPaymentFailed } = await import('./notification-triggers')
      void notifySubscriptionPaymentFailed(sub.tenantId, sub.id, sub.customerId, reason).catch(() => undefined)
    }
  }

  return { processed, failed }
}

export async function retrySubscription(tenantId: string, id: string) {
  const sub = await getSubscription(tenantId, id)
  if (sub.status !== SubscriptionStatus.PAUSED) {
    throw new ApiError(400, 'Only paused subscriptions can be retried')
  }
  await tenantDb.subscription.update({
    where: { id },
    data: { status: SubscriptionStatus.ACTIVE, nextOrderDate: new Date(), lastFailureReason: null },
  })
  return getSubscription(tenantId, id)
}
