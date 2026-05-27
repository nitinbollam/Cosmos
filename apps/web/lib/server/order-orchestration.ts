import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { orderDb, paymentDb } from './db'
import {
  applyCreditUsed,
  assertCreditAvailable,
  netTermsExposure,
  releaseCreditUsed,
} from './credit-limit'
import * as inv from './inventory'
import { applyCapturedPayment, linkPaymentIntent } from './order-payment-sync'
import * as payments from './payments'
import { canTransitionOrderStatus, fulfillmentTaskStatusToOrderStatus, type OrderStatus } from './order-status'
import { ApiError } from './session'
import * as wmsFulfillment from './wms-fulfillment'

function parseCompletedSteps(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : []
}

async function ensureSaga(orderId: string, tenantId: string, correlationId: string) {
  const existing = await orderDb.orderSaga.findUnique({ where: { orderId } })
  if (existing) return existing
  return orderDb.orderSaga.create({
    data: {
      id: randomUUID(),
      orderId,
      tenantId,
      status: 'PENDING',
      correlationId,
      completedSteps: [],
      compensations: {},
    },
  })
}

export async function transitionOrderStatus(
  tenantId: string,
  orderId: string,
  nextStatus: OrderStatus,
  extra?: Partial<{ confirmedAt: Date; cancelledAt: Date; failureReason: string | null }>,
) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  const current = order.status as OrderStatus
  if (current === nextStatus) return order
  if (!canTransitionOrderStatus(current, nextStatus)) {
    throw new ApiError(400, `Cannot transition order from ${current} to ${nextStatus}`)
  }
  return orderDb.order.update({
    where: { id: orderId },
    data: { status: nextStatus, ...extra },
    include: { lineItems: true, saga: true },
  })
}

/** Reserve stock, create WMS task, and move order to PROCESSING. Idempotent on saga steps. */
export async function runOrderFulfillmentPipeline(
  orderId: string,
  tenantId: string,
  correlationId: string,
): Promise<void> {
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) return
  if (order.status === 'CANCELLED' || order.status === 'FAILED' || order.status === 'DELIVERED') return

  const saga = await ensureSaga(orderId, tenantId, correlationId)
  const steps = parseCompletedSteps(saga.completedSteps)

  await orderDb.orderSaga.update({
    where: { id: saga.id },
    data: { status: 'RUNNING', correlationId },
  })

  try {
    if (!steps.includes('RESERVE_INVENTORY')) {
      for (const item of order.lineItems) {
        await inv.reserveStock(tenantId, {
          skuId: item.skuId,
          warehouseId: item.warehouseId,
          quantity: item.quantity,
          orderId,
          correlationId,
        })
      }
      steps.push('RESERVE_INVENTORY')
      await orderDb.orderSaga.update({
        where: { id: saga.id },
        data: { completedSteps: steps },
      })
    }

    if (!steps.includes('CREATE_FULFILLMENT')) {
      try {
        await wmsFulfillment.createFulfillmentTask(tenantId, {
          orderId,
          correlationId,
          lineItems: order.lineItems.map((li) => ({
            skuId: li.skuId,
            warehouseId: li.warehouseId,
            quantity: li.quantity,
          })),
        })
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) throw err
      }
      steps.push('CREATE_FULFILLMENT')
      await orderDb.orderSaga.update({
        where: { id: saga.id },
        data: { completedSteps: steps },
      })
    }

    if (!steps.includes('CONFIRM_ORDER')) {
      const confirmedAt = order.confirmedAt ?? new Date()
      const current = order.status as OrderStatus
      if (current === 'PENDING' || current === 'CONFIRMED') {
        await orderDb.order.update({
          where: { id: orderId },
          data: {
            status: 'PROCESSING',
            confirmedAt,
          },
        })
      }
      if (order.paymentMethod === 'NET_TERMS') {
        const exposure = netTermsExposure(Number(order.totalAmount), Number(order.amountPaid ?? 0))
        await applyCreditUsed(tenantId, order.customerId, exposure)
      }
      steps.push('CONFIRM_ORDER')
    }

    await orderDb.orderSaga.update({
      where: { id: saga.id },
      data: { status: 'COMPLETED', completedSteps: steps, failureReason: null },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Order pipeline failed'
    await inv.releaseReservationsForOrder(tenantId, orderId).catch(() => undefined)
    await orderDb.orderSaga.update({
      where: { id: saga.id },
      data: { status: 'FAILED', failureReason: message },
    })
    if (order.status === 'PENDING') {
      await orderDb.order.update({
        where: { id: orderId },
        data: { status: 'FAILED', failureReason: message },
      })
    }
    throw err instanceof ApiError ? err : new ApiError(500, message)
  }
}

export async function tryCaptureAuthorizedPayment(tenantId: string, orderId: string, correlationId: string) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) return { captured: false as const }

  let intentId = order.paymentIntentId
  if (!intentId) {
    const intent = await paymentDb.paymentIntent.findFirst({
      where: { tenantId, orderId, status: 'AUTHORIZED' },
      orderBy: { createdAt: 'desc' },
    })
    intentId = intent?.id ?? null
  }
  if (!intentId) return { captured: false as const }

  const intent = await paymentDb.paymentIntent.findFirst({ where: { id: intentId, tenantId } })
  if (!intent || intent.status !== 'AUTHORIZED') return { captured: false as const }

  await payments.capture(tenantId, intentId, correlationId)
  await applyCapturedPayment(tenantId, orderId, Number(intent.amount))
  await linkPaymentIntent(tenantId, orderId, intentId)
  return { captured: true as const, paymentIntentId: intentId }
}

export async function onFulfillmentPacked(tenantId: string, orderId: string) {
  await transitionOrderStatus(tenantId, orderId, 'PACKED')
  const correlationId = randomUUID()
  await tryCaptureAuthorizedPayment(tenantId, orderId, correlationId).catch(() => undefined)
}

export async function onFulfillmentDispatched(tenantId: string, orderId: string) {
  await transitionOrderStatus(tenantId, orderId, 'SHIPPED')
}

export async function onDeliveryStopDelivered(tenantId: string, orderId: string) {
  await transitionOrderStatus(tenantId, orderId, 'DELIVERED')
}

export async function syncOrderFromFulfillmentTask(tenantId: string, taskId: string) {
  const task = await wmsFulfillment.getFulfillmentTask(tenantId, taskId)
  const mapped = fulfillmentTaskStatusToOrderStatus(task.status)
  if (!mapped) return null
  return transitionOrderStatus(tenantId, task.orderId, mapped)
}

export async function cancelOrderWithCompensation(tenantId: string, orderId: string, reason: string) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.status === 'CANCELLED' || order.status === 'DELIVERED') return order

  await wmsFulfillment.cancelFulfillmentByOrder(tenantId, orderId, 'cancel').catch(() => undefined)
  await inv.releaseReservationsForOrder(tenantId, orderId).catch(() => undefined)

  if (order.paymentMethod === 'NET_TERMS') {
    const exposure = netTermsExposure(Number(order.totalAmount), Number(order.amountPaid ?? 0))
    await releaseCreditUsed(tenantId, order.customerId, exposure).catch(() => undefined)
  }

  return orderDb.order.update({
    where: { id: orderId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      failureReason: reason,
    },
    include: { lineItems: true, saga: true },
  })
}
