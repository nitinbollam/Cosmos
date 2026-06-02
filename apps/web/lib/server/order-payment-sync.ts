import { Prisma } from '@/generated/prisma-order'
import { orderDb } from './db'

export async function linkPaymentIntent(tenantId: string, orderId: string, paymentIntentId: string) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) return
  if (order.paymentIntentId === paymentIntentId) return
  await orderDb.order.update({
    where: { id: orderId },
    data: { paymentIntentId },
  })
}

export async function applyCapturedPayment(tenantId: string, orderId: string, amount: number) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) return
  const total = new Prisma.Decimal(order.totalAmount)
  const paidSoFar = new Prisma.Decimal(order.amountPaid ?? 0)
  const nextPaid = Prisma.Decimal.min(paidSoFar.plus(amount), total)
  await orderDb.order.update({
    where: { id: orderId },
    data: { amountPaid: nextPaid },
  })
}
