import { Prisma } from '@/generated/prisma-order'
import { orderDb } from './db'

/** Card/ACH checkout authorizes payment after order creation — defer fulfillment until paid. */
export function defersFulfillmentUntilPayment(paymentMethod: string): boolean {
  return paymentMethod === 'CARD' || paymentMethod === 'ACH'
}

export async function linkPaymentIntent(tenantId: string, orderId: string, paymentIntentId: string) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) return
  if (order.paymentIntentId === paymentIntentId) return
  await orderDb.order.update({
    where: { id: orderId },
    data: { paymentIntentId },
  })
}

/**
 * Count captured money as paid on the order (capped at its total) and emit the
 * `finance.payment_captured` webhook. `source` identifies the payment: a payment intent (also the
 * event's dedupe key) or a tender such as a gift card.
 */
export async function applyCapturedPayment(
  tenantId: string,
  orderId: string,
  amount: number,
  source: { paymentIntentId?: string; method?: string } = {},
) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) return
  const total = new Prisma.Decimal(order.totalAmount)
  const paidSoFar = new Prisma.Decimal(order.amountPaid ?? 0)
  const nextPaid = Prisma.Decimal.min(paidSoFar.plus(amount), total)
  await orderDb.order.update({
    where: { id: orderId },
    data: { amountPaid: nextPaid },
  })
  const { emitOrderEvent } = await import('./domain-events')
  void emitOrderEvent(
    tenantId,
    'finance.payment_captured',
    orderId,
    { amount, paymentIntentId: source.paymentIntentId ?? null, method: source.method ?? null },
    source.paymentIntentId ? { key: source.paymentIntentId } : {},
  )
}
