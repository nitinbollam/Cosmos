import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { orderDb, paymentDb, wmsDb } from './db'
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
import * as backorders from './backorders'
import * as dropShip from './drop-ship'

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
    const unallocatedStock = order.lineItems.filter(
      (li) => li.fulfillmentType !== 'DROP_SHIP' && (li.quantityAllocated ?? 0) < li.quantity,
    )
    if (!steps.includes('RESERVE_INVENTORY') || unallocatedStock.length > 0) {
      const stockLines = order.lineItems.filter((li) => li.fulfillmentType !== 'DROP_SHIP')
      let anyBackordered = false

      for (const item of stockLines) {
        const remainingToAllocate = item.quantity - (item.quantityAllocated ?? 0)
        if (remainingToAllocate > 0) {
          const result = await backorders.reserveLineWithBackorder(tenantId, {
            orderId,
            orderLineItemId: item.id,
            skuId: item.skuId,
            warehouseId: item.warehouseId,
            quantity: remainingToAllocate,
            correlationId,
            preferredBatchId: item.preferredBatchId,
          })
          if (result.backordered > 0) anyBackordered = true
        }
      }

      if (anyBackordered) {
        await orderDb.order.update({
          where: { id: orderId },
          data: { status: 'BACKORDERED' },
        })
      }

      if (!steps.includes('RESERVE_INVENTORY')) {
        steps.push('RESERVE_INVENTORY')
      }
      await orderDb.orderSaga.update({
        where: { id: saga.id },
        data: { completedSteps: steps },
      })
    }

    if (!steps.includes('CREATE_DROP_SHIP')) {
      const hasDropShip = order.lineItems.some((li) => li.fulfillmentType === 'DROP_SHIP')
      if (hasDropShip) {
        await dropShip.createDropShipPurchaseOrders(tenantId, orderId)
      }
      steps.push('CREATE_DROP_SHIP')
      await orderDb.orderSaga.update({
        where: { id: saga.id },
        data: { completedSteps: steps },
      })
    }

    const openTask = await wmsDb.fulfillmentTask.findFirst({
      where: { tenantId, orderId, status: { in: ['PENDING', 'PICKING', 'PACKED'] } },
    })

    if (!openTask || !steps.includes('CREATE_FULFILLMENT')) {
      const refreshedOrder = (await orderDb.order.findFirst({
        where: { id: orderId, tenantId },
        include: { lineItems: true },
      })) || order

      const fulfillLines = refreshedOrder.lineItems.filter(
        (li) => li.fulfillmentType !== 'DROP_SHIP' && li.quantityAllocated > 0,
      )
      if (fulfillLines.length > 0 && !openTask) {
        try {
          await wmsFulfillment.createFulfillmentTask(tenantId, {
            orderId,
            correlationId,
            lineItems: fulfillLines.map((li) => ({
              skuId: li.skuId,
              warehouseId: li.warehouseId,
              quantity: li.quantityAllocated,
              batchId: li.preferredBatchId ?? undefined,
            })),
          })
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 409)) throw err
        }
      }
      if (!steps.includes('CREATE_FULFILLMENT')) {
        steps.push('CREATE_FULFILLMENT')
      }
      await orderDb.orderSaga.update({
        where: { id: saga.id },
        data: { completedSteps: steps },
      })
    }

    if (!steps.includes('CONFIRM_ORDER')) {
      const confirmedAt = order.confirmedAt ?? new Date()
      const current = order.status as OrderStatus
      const refreshed = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
      const nextStatus: OrderStatus =
        refreshed?.status === 'BACKORDERED' ? 'BACKORDERED' : 'PROCESSING'

      if (current === 'PENDING' || current === 'CONFIRMED' || current === 'BACKORDERED') {
        if (nextStatus !== current) {
          await orderDb.order.update({
            where: { id: orderId },
            data: {
              status: nextStatus,
              confirmedAt,
            },
          })
        } else if (!order.confirmedAt) {
          await orderDb.order.update({
            where: { id: orderId },
            data: { confirmedAt },
          })
        }
      }

      const dropOnly =
        order.lineItems.length > 0 &&
        order.lineItems.every((li) => li.fulfillmentType === 'DROP_SHIP')
      if (dropOnly) {
        await orderDb.order.update({
          where: { id: orderId },
          data: { status: 'CONFIRMED', confirmedAt },
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
  await tryCaptureAuthorizedPayment(tenantId, orderId, correlationId).catch((err) =>
    console.error(`[payments] capture at pack failed for order ${orderId}:`, err),
  )
}

/**
 * Dispatch a packed fulfillment task end-to-end:
 *  1. enforce serial assignment for serial-tracked SKUs
 *  2. commit inventory (decrement on-hand, fulfill reservations, STOCK_SHIPPED ledger)
 *  3. move SHORT-picked remainders to backorder
 *  4. mark the WMS task DISPATCHED
 *  5. transition the order, invoice the shipped quantities, post COGS
 *
 * Inventory is committed before the WMS status flips so a failure leaves the task
 * PACKED (retryable) rather than DISPATCHED-with-no-stock-movement.
 */
export async function dispatchFulfillmentTask(tenantId: string, taskId: string) {
  const task = await wmsFulfillment.getFulfillmentTaskRaw(tenantId, taskId)
  if (task.status !== 'PACKED') throw new ApiError(400, 'Task must be PACKED before dispatch')

  const shippedLines = task.pickLines
    .map((p) => ({
      skuId: p.skuId,
      warehouseId: p.warehouseId,
      batchId: p.batchId ?? undefined,
      quantity: p.pickedQty,
    }))
    .filter((l) => l.quantity > 0)

  const serials = await import('./inventory-serials')
  await serials.enforceAndShipSerialsForOrder(tenantId, task.orderId, shippedLines)

  const { shipped } = await inv.commitShipmentForOrder(tenantId, task.orderId, 'system', shippedLines)

  await moveShortPicksToBackorder(tenantId, task.orderId, task.pickLines)

  const updated = await wmsFulfillment.markFulfillmentDispatched(tenantId, taskId)

  await onFulfillmentDispatched(tenantId, task.orderId, shipped)

  return { taskId: updated.taskId, orderId: task.orderId, status: updated.status, shipped }
}

/** SHORT-picked quantity goes back to backorder so a receipt can re-fulfill it. */
async function moveShortPicksToBackorder(
  tenantId: string,
  orderId: string,
  pickLines: Array<{ skuId: string; warehouseId: string; quantity: number; pickedQty: number }>,
) {
  const shorts = pickLines.filter((p) => p.pickedQty < p.quantity)
  if (shorts.length === 0) return

  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) return

  for (const p of shorts) {
    const shortQty = p.quantity - p.pickedQty
    const line = order.lineItems.find((li) => li.skuId === p.skuId && li.warehouseId === p.warehouseId)
    if (!line) continue

    await orderDb.orderLineItem.update({
      where: { id: line.id },
      data: {
        quantityAllocated: { decrement: Math.min(shortQty, line.quantityAllocated) },
        quantityBackordered: { increment: shortQty },
      },
    })
    await orderDb.backorderLine.upsert({
      where: { orderLineItemId: line.id },
      create: {
        id: randomUUID(),
        tenantId,
        orderId,
        orderLineItemId: line.id,
        skuId: p.skuId,
        warehouseId: p.warehouseId,
        quantity: shortQty,
        status: 'OPEN',
      },
      update: {
        quantity: { increment: shortQty },
        status: 'OPEN',
      },
    })
  }
}

export async function onFulfillmentDispatched(
  tenantId: string,
  orderId: string,
  shipped?: Array<{ skuId: string; quantity: number }>,
) {
  await transitionOrderStatus(tenantId, orderId, 'SHIPPED')
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) return

  const billedLines =
    shipped ?? order.lineItems.map((li) => ({ skuId: li.skuId, quantity: li.quantity }))

  const { invoiceShipmentForOrder } = await import('./invoices')
  await invoiceShipmentForOrder(tenantId, orderId, billedLines).catch((err) =>
    console.error(`[orders] invoicing failed for order ${orderId}:`, err),
  )

  void import('./sales-channels/fulfillment-sync')
    .then(({ syncChannelFulfillmentForOrder }) => syncChannelFulfillmentForOrder(tenantId, orderId))
    .catch((err) => console.error(`[sales-channels] fulfillment sync failed for order ${orderId}:`, err))

  const { computeOrderCogs, postCogsJournal } = await import('./operations-gl')
  const cogs = await computeOrderCogs(tenantId, billedLines)
  await postCogsJournal(tenantId, orderId, cogs).catch((err) =>
    console.error(`[gl] COGS journal failed for order ${orderId}:`, err),
  )
  const { notifyOrderShipped } = await import('./notification-triggers')
  void notifyOrderShipped(tenantId, orderId, order.customerId).catch(() => undefined)
  const { auditLog } = await import('./audit-log')
  void auditLog(tenantId, { action: 'order.shipped', entityType: 'Order', entityId: orderId }).catch(() => undefined)
}

export async function onDeliveryStopDelivered(tenantId: string, orderId: string) {
  await transitionOrderStatus(tenantId, orderId, 'DELIVERED')
  const { earnPointsForDeliveredOrder } = await import('./loyalty')
  void earnPointsForDeliveredOrder(tenantId, orderId).catch((err) =>
    console.error(`[loyalty] earn points failed for order ${orderId}:`, err),
  )
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

  // Compensate payments first: a cancel that can't unwind money must fail loudly.
  const correlationId = randomUUID()
  const intents = await paymentDb.paymentIntent.findMany({
    where: { tenantId, orderId, status: { in: ['AUTHORIZED', 'CAPTURED'] } },
  })
  for (const intent of intents) {
    if (intent.status === 'AUTHORIZED') {
      await payments.voidIntent(tenantId, intent.id, correlationId)
    } else {
      const refundable = Number(intent.amount) - Number(intent.refundedAmount ?? 0)
      if (refundable > 0.009) {
        await payments.refund(tenantId, intent.id, refundable, correlationId)
        await orderDb.order.update({
          where: { id: orderId },
          data: { amountPaid: { decrement: new Prisma.Decimal(refundable) } },
        })
      }
    }
  }

  await wmsFulfillment.cancelFulfillmentByOrder(tenantId, orderId, 'cancel').catch(() => undefined)
  await inv.releaseReservationsForOrder(tenantId, orderId).catch(() => undefined)

  await orderDb.backorderLine.updateMany({
    where: { tenantId, orderId, status: { in: ['OPEN', 'PARTIAL'] } },
    data: { status: 'CANCELLED' },
  })

  if (order.paymentMethod === 'NET_TERMS') {
    const exposure = netTermsExposure(Number(order.totalAmount), Number(order.amountPaid ?? 0))
    await releaseCreditUsed(tenantId, order.customerId, exposure).catch(() => undefined)
  }

  const { voidAuthorizedPaymentsForOrder } = await import('./order-payment-admin')
  await voidAuthorizedPaymentsForOrder(tenantId, orderId).catch(() => undefined)

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
