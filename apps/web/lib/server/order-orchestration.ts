import { randomUUID } from 'node:crypto'
import { Prisma } from '@/generated/prisma-order'
import { crmDb, orderDb, paymentDb, wmsDb } from './db'
import {
  applyCreditUsed,
  assertCreditAvailable,
  netTermsExposure,
  releaseCreditUsed,
  releaseOrderCredit,
} from './credit-limit'
import * as inv from './inventory'
import * as payments from './payments'
import {
  canTransitionOrderStatus,
  fulfillmentTaskStatusToOrderStatus,
  isOrderCancellationEligible,
  type OrderStatus,
} from './order-status'
import { ApiError } from './session'
import * as wmsFulfillment from './wms-fulfillment'
import * as backorders from './backorders'
import * as dropShip from './drop-ship'
import { emitDomainEvent, emitOrderEvent } from './domain-events'

import { swallowed } from './fire-and-forget'
function parseCompletedSteps(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : []
}

async function ensureSaga(orderId: string, tenantId: string, correlationId: string) {
  const existing = await orderDb.orderSaga.findUnique({ where: { orderId } })
  if (existing) return existing
  try {
    return await orderDb.orderSaga.create({
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
  } catch (err) {
    // A concurrent run created it first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await orderDb.orderSaga.findUnique({ where: { orderId } })
      if (winner) return winner
    }
    throw err
  }
}

/** A RUNNING saga that has not written for this long is treated as crashed and may be taken over. */
const SAGA_LEASE_MS = 2 * 60_000

export async function transitionOrderStatus(
  tenantId: string,
  orderId: string,
  nextStatus: OrderStatus,
  extra?: Partial<{ confirmedAt: Date; cancelledAt: Date; failureReason: string | null }>,
  options?: { coordinationHeld?: boolean },
) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  const current = order.status as OrderStatus
  if (current === nextStatus) return order
  if (!canTransitionOrderStatus(current, nextStatus)) {
    throw new ApiError(400, `Cannot transition order from ${current} to ${nextStatus}`)
  }
  // Packing/shipping must be serialized with cancellation even for flows without a WMS task
  // (POS, van sale, and drop ship). Both operations claim this saga row; the status change and
  // release happen in one order-database transaction so cancellation sees either side atomically.
  if ((nextStatus === 'PACKED' || nextStatus === 'SHIPPED') && !options?.coordinationHeld) {
    const saga = await ensureSaga(orderId, tenantId, randomUUID())
    return orderDb.$transaction(async (tx) => {
      const claimed = await tx.orderSaga.updateMany({
        where: { id: saga.id, OR: [{ status: { notIn: ['RUNNING', 'COMPENSATING'] as never[] } }] },
        data: { status: 'COMPENSATING' as never },
      })
      if (claimed.count !== 1)
        throw new ApiError(409, 'Fulfillment or cancellation is already active for this order')
      const moved = await tx.order.updateMany({
        where: { id: orderId, tenantId, status: current as never },
        data: { status: nextStatus as never, ...extra },
      })
      if (moved.count !== 1) {
        const now = await tx.order.findFirst({ where: { id: orderId, tenantId } })
        if (now?.status !== nextStatus)
          throw new ApiError(
            409,
            `Order status changed from ${current} to ${now?.status ?? 'unknown'} while moving it to ${nextStatus}`,
          )
      }
      await tx.orderSaga.update({ where: { id: saga.id }, data: { status: saga.status as never } })
      return tx.order.findFirstOrThrow({
        where: { id: orderId, tenantId },
        include: { lineItems: true, saga: true },
      })
    })
  }
  // Compare-and-set on the status we checked: of two callers that read the same status (pack and
  // cancel, say) only one write lands; the other is told what the order became.
  const moved = await orderDb.order.updateMany({
    where: { id: orderId, tenantId, status: current as never },
    data: { status: nextStatus as never, ...extra },
  })
  if (moved.count !== 1) {
    const now = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
    if (now?.status === nextStatus) return now
    throw new ApiError(
      409,
      `Order status changed from ${current} to ${now?.status ?? 'unknown'} while moving it to ${nextStatus}`,
    )
  }
  return orderDb.order.findFirstOrThrow({
    where: { id: orderId, tenantId },
    include: { lineItems: true, saga: true },
  })
}

/**
 * Hold the shared order saga lock around fulfillment effects that happen before the terminal
 * PACKED/SHIPPED status write (immediate POS/van sales and supplier drop-ship confirmation).
 * Cancellation claims the same lock for its entire compensation sequence.
 */
export async function withOrderFulfillmentLock<T>(
  tenantId: string,
  orderId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  if (!isOrderCancellationEligible(order.status))
    throw new ApiError(409, `Order is no longer eligible for fulfillment from ${order.status}`)
  const saga = await ensureSaga(orderId, tenantId, randomUUID())
  const claimed = await orderDb.orderSaga.updateMany({
    where: { id: saga.id, OR: [{ status: { notIn: ['RUNNING', 'COMPENSATING'] as never[] } }] },
    data: { status: 'COMPENSATING' as never },
  })
  if (claimed.count !== 1)
    throw new ApiError(409, 'Fulfillment or cancellation is already active for this order')
  try {
    return await fn()
  } finally {
    await orderDb.orderSaga.updateMany({
      where: { id: saga.id, status: 'COMPENSATING' as never },
      data: { status: saga.status as never },
    })
  }
}

/** Set a status only if the order is still in one of `from`. Returns whether the write landed. */
async function setStatusIf(
  tenantId: string,
  orderId: string,
  from: OrderStatus[],
  data: { status: OrderStatus; confirmedAt?: Date; failureReason?: string | null },
) {
  const res = await orderDb.order.updateMany({
    where: { id: orderId, tenantId, status: { in: from as never[] } },
    data: data as never,
  })
  return res.count === 1
}

export type PipelineOutcome = 'COMPLETED' | 'ALREADY_RUNNING' | 'SKIPPED'

/** Statuses a failed pipeline moves to FAILED. Packed and later orders hold committed stock and are left alone. */
const PRE_PACK_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'BACKORDERED', 'PROCESSING']
const OPEN_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'BACKORDERED']

/**
 * Reserve stock, create the WMS task, and move the order to PROCESSING.
 *
 * Safe to run twice, even at the same time: a run claims the saga with one compare-and-set (a
 * second caller gets ALREADY_RUNNING), every step records itself on the saga as soon as its effect
 * is done, and the effects themselves (credit, status, allocation) are idempotent. A run that
 * fails undoes what it can, records each undo under `compensations`, moves a not-yet-packed order
 * to FAILED, and rethrows.
 */
export async function runOrderFulfillmentPipeline(
  orderId: string,
  tenantId: string,
  correlationId: string,
): Promise<PipelineOutcome> {
  const isTerminal = (status: string) =>
    status === 'CANCELLED' || status === 'FAILED' || status === 'DELIVERED'
  const peek = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    select: { status: true },
  })
  if (!peek || isTerminal(peek.status)) return 'SKIPPED'

  const sagaRow = await ensureSaga(orderId, tenantId, correlationId)
  const claim = await orderDb.orderSaga.updateMany({
    where: {
      id: sagaRow.id,
      OR: [
        { status: { notIn: ['RUNNING', 'COMPENSATING'] } },
        { updatedAt: { lt: new Date(Date.now() - SAGA_LEASE_MS) } },
      ],
    },
    data: { status: 'RUNNING', correlationId },
  })
  if (claim.count !== 1) return 'ALREADY_RUNNING'

  // Read after claiming: another run may have advanced the order or the saga before we got here.
  const saga = await orderDb.orderSaga.findUniqueOrThrow({ where: { id: sagaRow.id } })
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order || isTerminal(order.status)) {
    await orderDb.orderSaga.update({ where: { id: saga.id }, data: { status: sagaRow.status } })
    return 'SKIPPED'
  }
  const steps = parseCompletedSteps(saga.completedSteps)
  const persistSteps = () =>
    orderDb.orderSaga.update({ where: { id: saga.id }, data: { completedSteps: steps } })

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
        await setStatusIf(tenantId, orderId, PRE_PACK_STATUSES, { status: 'BACKORDERED' })
      }

      if (!steps.includes('RESERVE_INVENTORY')) {
        steps.push('RESERVE_INVENTORY')
      }
      await persistSteps()
    }

    if (!steps.includes('CREATE_DROP_SHIP')) {
      const hasDropShip = order.lineItems.some((li) => li.fulfillmentType === 'DROP_SHIP')
      if (hasDropShip) {
        await dropShip.createDropShipPurchaseOrders(tenantId, orderId)
      }
      steps.push('CREATE_DROP_SHIP')
      await persistSteps()
    }

    const openTask = await wmsDb.fulfillmentTask.findFirst({
      where: { tenantId, orderId, status: { in: ['PENDING', 'PICKING', 'PACKED'] } },
    })

    if (!openTask || !steps.includes('CREATE_FULFILLMENT')) {
      const refreshedOrder =
        (await orderDb.order.findFirst({
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
      await persistSteps()
    }

    if (!steps.includes('CONFIRM_ORDER')) {
      const confirmedAt = order.confirmedAt ?? new Date()
      const refreshed = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
      const current = (refreshed?.status ?? order.status) as OrderStatus
      const nextStatus: OrderStatus = current === 'BACKORDERED' ? 'BACKORDERED' : 'PROCESSING'

      if (OPEN_STATUSES.includes(current)) {
        if (nextStatus !== current) {
          await setStatusIf(tenantId, orderId, OPEN_STATUSES, { status: nextStatus, confirmedAt })
        } else if (!order.confirmedAt) {
          await orderDb.order.updateMany({
            where: { id: orderId, tenantId },
            data: { confirmedAt },
          })
        }
      }

      const dropOnly =
        order.lineItems.length > 0 &&
        order.lineItems.every((li) => li.fulfillmentType === 'DROP_SHIP')
      if (dropOnly) {
        await setStatusIf(tenantId, orderId, PRE_PACK_STATUSES, {
          status: 'CONFIRMED',
          confirmedAt,
        })
      }

      if (order.paymentMethod === 'NET_TERMS') {
        const exposure = netTermsExposure(Number(order.totalAmount), Number(order.amountPaid ?? 0))
        // Recorded per order, so repeating this step after a crash cannot consume the credit twice.
        await applyCreditUsed(tenantId, order.customerId, exposure, orderId)
      }
      steps.push('CONFIRM_ORDER')
      await persistSteps()
    }

    await orderDb.orderSaga.update({
      where: { id: saga.id },
      data: { status: 'COMPLETED', completedSteps: steps, failureReason: null },
    })
    return 'COMPLETED'
  } catch (err) {
    await failPipeline(tenantId, orderId, saga.id, correlationId, err)
    throw err instanceof ApiError
      ? err
      : new ApiError(500, err instanceof Error ? err.message : 'Order pipeline failed')
  }
}

/**
 * End state of a failed pipeline: stock holds, the warehouse task and any applied credit are
 * released through their idempotent paths, the order moves to FAILED if it has not been packed,
 * and each undo is recorded on the saga so an operator can see what did not complete. An undo that
 * fails is logged with the order and correlation ids and left for the reservation safety net.
 */
async function failPipeline(
  tenantId: string,
  orderId: string,
  sagaId: string,
  correlationId: string,
  err: unknown,
) {
  const message = err instanceof Error ? err.message : 'Order pipeline failed'
  const compensations: Record<string, string> = {}
  const undo = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      compensations[name] = 'done'
    } catch (undoErr) {
      compensations[name] =
        `failed: ${undoErr instanceof Error ? undoErr.message : String(undoErr)}`.slice(0, 300)
      console.error(
        `[orders] saga undo "${name}" failed for order ${orderId} (correlation ${correlationId}):`,
        undoErr,
      )
    }
  }
  console.error(
    `[orders] pipeline failed for order ${orderId} (correlation ${correlationId}): ${message}`,
  )

  await undo('reservations', () => inv.releaseReservationsForOrder(tenantId, orderId))
  await undo('fulfillment', () =>
    wmsFulfillment.cancelFulfillmentByOrder(tenantId, orderId, 'pipeline failed'),
  )
  await undo('credit', async () => {
    const applied = await crmDb.creditApplication.findFirst({ where: { tenantId, orderId } })
    if (applied && !applied.releasedAt) {
      await releaseOrderCredit(tenantId, applied.customerId, orderId, Number(applied.amount))
    }
  })
  await undo('status', async () => {
    await setStatusIf(tenantId, orderId, PRE_PACK_STATUSES, {
      status: 'FAILED',
      failureReason: message,
    })
  })
  await orderDb.orderSaga.update({
    where: { id: sagaId },
    data: { status: 'FAILED', failureReason: message, compensations },
  })
}

export async function tryCaptureAuthorizedPayment(
  tenantId: string,
  orderId: string,
  correlationId: string,
) {
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

  // capture() already counts the payment on the order (and links it); applying it again here
  // double-counted partial payments.
  await payments.capture(tenantId, intentId, correlationId)
  return { captured: true as const, paymentIntentId: intentId }
}

/** The warehouse packed a fulfillment task: the order is fulfilled (webhook `order.fulfilled`). */
export async function onFulfillmentPacked(
  tenantId: string,
  orderId: string,
  fulfillmentTaskId?: string,
) {
  await transitionOrderStatus(tenantId, orderId, 'PACKED')
  const correlationId = randomUUID()
  await tryCaptureAuthorizedPayment(tenantId, orderId, correlationId).catch((err) =>
    console.error(`[payments] capture at pack failed for order ${orderId}:`, err),
  )
  // Per task: a backordered remainder is packed (and fulfilled) again later.
  void emitOrderEvent(
    tenantId,
    'order.fulfilled',
    orderId,
    { status: 'PACKED', fulfillmentTaskId: fulfillmentTaskId ?? null },
    { key: fulfillmentTaskId ?? orderId },
  )
}

/**
 * Dispatch a packed fulfillment task end-to-end:
 *  1. enforce serial assignment for serial-tracked SKUs, then commit inventory (decrement
 *     on-hand, fulfill reservations, STOCK_SHIPPED ledger) and record a ShipmentCommit
 *  2. move SHORT-picked remainders to backorder
 *  3. mark the WMS task DISPATCHED
 *  4. transition the order, invoice the shipped quantities, queue COGS
 *
 * Each step is recorded on the task (`dispatchStep`) and is safe to repeat, so a call that fails
 * part-way is retried by calling dispatch again: it resumes after the last completed step and ends
 * in the same state as an uninterrupted run. A lease on the task keeps two calls from interleaving.
 */
const DISPATCH_LEASE_MS = 2 * 60_000

export async function dispatchFulfillmentTask(tenantId: string, taskId: string) {
  await wmsFulfillment.getFulfillmentTaskRaw(tenantId, taskId) // 404 for an unknown task

  // Claim the task. updateMany is a single compare-and-set, so only one caller wins.
  const now = new Date()
  const claim = await wmsDb.fulfillmentTask.updateMany({
    where: {
      id: taskId,
      tenantId,
      OR: [
        { dispatchClaimedAt: null },
        { dispatchClaimedAt: { lt: new Date(now.getTime() - DISPATCH_LEASE_MS) } },
      ],
    },
    data: { dispatchClaimedAt: now },
  })
  if (claim.count !== 1) throw new ApiError(409, 'Task is already being dispatched')

  try {
    return await runDispatch(tenantId, taskId)
  } finally {
    // Release the lease so an immediate retry is not told the task is busy. A crash leaves it to expire.
    await wmsDb.fulfillmentTask
      .updateMany({ where: { id: taskId, tenantId }, data: { dispatchClaimedAt: null } })
      .catch(swallowed('order-orchestration.dispatchFulfillmentTask'))
  }
}

async function runDispatch(tenantId: string, taskId: string) {
  // Read after claiming: another caller may have advanced the task since the claim was attempted.
  const task = await wmsFulfillment.getFulfillmentTaskRaw(tenantId, taskId)
  const step = task.dispatchStep ?? null
  const resuming = task.status === 'DISPATCHED' && step !== null && step !== 'POSTED'

  if (task.status === 'DISPATCHED' && step === 'POSTED') {
    // Already complete: return the stored result instead of failing a client retry.
    const { shipped } = await inv.commitShipmentForOrder(
      tenantId,
      task.orderId,
      'system',
      undefined,
      taskId,
    )
    return { taskId: task.id, orderId: task.orderId, status: task.status, shipped }
  }
  if (task.status !== 'PACKED' && !resuming)
    throw new ApiError(400, 'Task must be PACKED before dispatch')

  const setStep = (dispatchStep: string) =>
    wmsDb.fulfillmentTask.update({ where: { id: taskId }, data: { dispatchStep } })

  const shippedLines = task.pickLines
    .map((p) => ({
      skuId: p.skuId,
      warehouseId: p.warehouseId,
      batchId: p.batchId ?? undefined,
      quantity: p.pickedQty,
    }))
    .filter((l) => l.quantity > 0)

  let shipped: Array<{ skuId: string; warehouseId: string; batchId: string; quantity: number }>
  if (step === null) {
    const serials = await import('./inventory-serials')
    await serials.enforceAndShipSerialsForOrder(tenantId, task.orderId, shippedLines)
    ;({ shipped } = await inv.commitShipmentForOrder(
      tenantId,
      task.orderId,
      'system',
      shippedLines,
      taskId,
    ))
    if (shippedLines.length > 0 && shipped.length === 0) {
      // Picked stock that "shipped" nothing would be invoiced as zero. Stop and say so.
      console.error(
        `[orders] dispatch committed no stock for picked task ${taskId} (order ${task.orderId})`,
      )
      throw new ApiError(
        500,
        `Dispatch of task ${taskId} found no stock to commit for order ${task.orderId}`,
      )
    }
    await setStep('COMMITTED')
  } else {
    ;({ shipped } = await inv.commitShipmentForOrder(
      tenantId,
      task.orderId,
      'system',
      undefined,
      taskId,
    ))
  }

  if (step === null || step === 'COMMITTED') {
    await moveShortPicksToBackorder(tenantId, task.orderId, task.pickLines, taskId)
    await setStep('BACKORDERED')
  }

  let status: string = task.status
  if (step !== 'MARKED') {
    if (task.status === 'PACKED') {
      const updated = await wmsFulfillment.markFulfillmentDispatched(tenantId, taskId)
      status = updated.status
    }
    await setStep('MARKED')
  }

  await onFulfillmentDispatched(tenantId, task.orderId, shipped, taskId)
  await setStep('POSTED')
  void emitDomainEvent(
    tenantId,
    'wms.shipment_dispatched',
    { fulfillmentTaskId: taskId, orderId: task.orderId, shipped },
    { key: taskId },
  )

  return {
    taskId,
    orderId: task.orderId,
    status: status === 'PACKED' ? 'DISPATCHED' : status,
    shipped,
  }
}

/**
 * SHORT-picked quantity goes back to backorder so a receipt can re-fulfill it. Each line's move is
 * recorded against the task in the same transaction, so a retried dispatch does not move it twice.
 */
async function moveShortPicksToBackorder(
  tenantId: string,
  orderId: string,
  pickLines: Array<{ skuId: string; warehouseId: string; quantity: number; pickedQty: number }>,
  fulfillmentTaskId?: string,
) {
  const shorts = pickLines.filter((p) => p.pickedQty < p.quantity)
  if (shorts.length === 0) return

  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) return

  await orderDb.$transaction(async (tx) => {
    for (const p of shorts) {
      const shortQty = p.quantity - p.pickedQty
      const line = order.lineItems.find(
        (li) => li.skuId === p.skuId && li.warehouseId === p.warehouseId,
      )
      if (!line) continue

      if (fulfillmentTaskId) {
        const moved = await tx.backorderMove.findFirst({
          where: { tenantId, fulfillmentTaskId, orderLineItemId: line.id },
        })
        if (moved) continue
        await tx.backorderMove.create({
          data: { tenantId, fulfillmentTaskId, orderLineItemId: line.id },
        })
      }

      await tx.orderLineItem.update({
        where: { id: line.id },
        data: {
          quantityAllocated: { decrement: Math.min(shortQty, line.quantityAllocated) },
          quantityBackordered: { increment: shortQty },
        },
      })
      await tx.backorderLine.upsert({
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
  })
}

export async function onFulfillmentDispatched(
  tenantId: string,
  orderId: string,
  shipped?: Array<{ skuId: string; quantity: number }>,
  /** The fulfillment task that shipped; an order with backorders ships more than once. */
  fulfillmentTaskId?: string,
  options?: { coordinationHeld?: boolean },
) {
  await transitionOrderStatus(tenantId, orderId, 'SHIPPED', undefined, options)
  const order = await orderDb.order.findFirst({
    where: { id: orderId, tenantId },
    include: { lineItems: true },
  })
  if (!order) return

  const billedLines =
    shipped ?? order.lineItems.map((li) => ({ skuId: li.skuId, quantity: li.quantity }))

  const { invoiceShipmentForOrder } = await import('./invoices')
  if (fulfillmentTaskId) {
    // A task dispatch must not finish without its invoice: let the error stop it so a retry bills it.
    await invoiceShipmentForOrder(tenantId, orderId, billedLines, fulfillmentTaskId)
  } else {
    await invoiceShipmentForOrder(tenantId, orderId, billedLines).catch((err) =>
      console.error(`[orders] invoicing failed for order ${orderId}:`, err),
    )
  }

  void import('./sales-channels/fulfillment-sync')
    .then(({ syncChannelFulfillmentForOrder }) => syncChannelFulfillmentForOrder(tenantId, orderId))
    .catch((err) =>
      console.error(`[sales-channels] fulfillment sync failed for order ${orderId}:`, err),
    )

  // Queued, not posted inline: a ledger outage must not block or roll back shipping.
  const { computeOrderCogs } = await import('./operations-gl')
  const { enqueuePostingJob } = await import('./posting-outbox')
  const cogs = await computeOrderCogs(tenantId, billedLines)
  await enqueuePostingJob(orderDb, {
    tenantId,
    kind: 'COGS_JOURNAL',
    sourceType: 'Order',
    sourceId: orderId,
    variant: fulfillmentTaskId ?? `ship:${randomUUID()}`,
    amount: cogs.toFixed(2),
  })
  const { notifyOrderShipped } = await import('./notification-triggers')
  void notifyOrderShipped(tenantId, orderId, order.customerId).catch(
    swallowed('order-orchestration.onFulfillmentDispatched'),
  )
  const { auditLog } = await import('./audit-log')
  void auditLog(tenantId, {
    action: 'order.shipped',
    entityType: 'Order',
    entityId: orderId,
  }).catch(swallowed('order-orchestration.onFulfillmentDispatched2'))
  void emitOrderEvent(
    tenantId,
    'order.shipped',
    orderId,
    { status: 'SHIPPED', fulfillmentTaskId: fulfillmentTaskId ?? null, shipped: billedLines },
    { key: fulfillmentTaskId ?? orderId },
  )
}

export async function onDeliveryStopDelivered(tenantId: string, orderId: string) {
  await transitionOrderStatus(tenantId, orderId, 'DELIVERED')
  void emitOrderEvent(
    tenantId,
    'order.delivered',
    orderId,
    { status: 'DELIVERED' },
    { key: orderId },
  )
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

type CancelState = {
  /** Step name -> 'done' or 'failed: <message>'. */
  steps: Record<string, string>
  /** Refunds already taken off `order.amountPaid`, by payment intent. */
  adjusted: Record<string, string>
  complete?: boolean
}

const CANCEL_LOCK_STATUS = 'COMPENSATING'

function readCancelState(compensations: unknown): CancelState {
  const raw = (compensations as { cancel?: Partial<CancelState> } | null)?.cancel
  return {
    steps: { ...(raw?.steps ?? {}) },
    adjusted: { ...(raw?.adjusted ?? {}) },
    complete: raw?.complete,
  }
}

/**
 * Cancel an order and undo everything it holds, or stop at the first step that fails and say which.
 *
 * Steps run in a fixed order: cancel the warehouse task, void or refund payments, release stock
 * reservations, close backorders, release customer credit, then (last) mark the order CANCELLED.
 * The order is not CANCELLED until every step has succeeded, so a failed cancel is simply called
 * again: finished steps are skipped (progress is kept in the saga's `compensations.cancel`), and
 * each step is safe to repeat on its own. A refund is taken off `amountPaid` before the money moves
 * and recorded per payment, so a crash between the two cannot be double-counted or lost. Credit is
 * released through `releaseOrderCredit`, exactly once.
 *
 * A saga lock (status COMPENSATING) keeps two cancels apart, and a claim on the order's open
 * fulfillment tasks keeps a dispatch from running underneath a cancel (and the reverse): whichever
 * starts second is told 409.
 */
export async function cancelOrderWithCompensation(
  tenantId: string,
  orderId: string,
  reason: string,
) {
  const order = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
  if (!order) throw new ApiError(404, 'Order not found')
  if (order.status !== 'CANCELLED' && !isOrderCancellationEligible(order.status)) {
    throw new ApiError(400, `An order that is ${order.status} cannot be cancelled`)
  }

  const saga0 = await ensureSaga(orderId, tenantId, randomUUID())
  if (order.status === 'CANCELLED' && readCancelState(saga0.compensations).complete) return order
  if (
    order.status !== 'CANCELLED' &&
    !canTransitionOrderStatus(order.status as OrderStatus, 'CANCELLED')
  ) {
    throw new ApiError(400, `An order that is ${order.status} cannot be cancelled`)
  }

  const lock = await orderDb.orderSaga.updateMany({
    where: {
      id: saga0.id,
      OR: [
        { status: { notIn: ['RUNNING', CANCEL_LOCK_STATUS] as never[] } },
        { updatedAt: { lt: new Date(Date.now() - SAGA_LEASE_MS) } },
      ],
    },
    data: { status: CANCEL_LOCK_STATUS as never },
  })
  if (lock.count !== 1)
    throw new ApiError(409, 'Fulfillment or cancellation is already active for this order')
  const restoreStatus = saga0.status === CANCEL_LOCK_STATUS ? 'FAILED' : saga0.status

  const claimedAt = new Date()
  let claimedTasks: string[] = []
  try {
    const saga = await orderDb.orderSaga.findUniqueOrThrow({ where: { id: saga0.id } })
    const state = readCancelState(saga.compensations)
    const persist = async () => {
      const fresh = await orderDb.orderSaga.findUniqueOrThrow({ where: { id: saga.id } })
      await orderDb.orderSaga.update({
        where: { id: saga.id },
        data: { compensations: { ...((fresh.compensations as object) ?? {}), cancel: state } },
      })
    }
    const step = async (name: string, fn: () => Promise<void>) => {
      if (state.steps[name] === 'done') return
      try {
        await fn()
        state.steps[name] = 'done'
        await persist()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        state.steps[name] = `failed: ${message}`.slice(0, 300)
        await persist().catch(swallowed('order-orchestration.step'))
        console.error(`[orders] cancel of order ${orderId} stopped at step "${name}": ${message}`)
        throw new ApiError(
          502,
          `Cancelling order stopped at step "${name}": ${message}. Nothing was lost; cancel the order again to continue from here.`,
        )
      }
    }

    const current = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
    if (
      !current ||
      (current.status !== 'CANCELLED' && !isOrderCancellationEligible(current.status))
    ) {
      throw new ApiError(
        400,
        `An order that is ${current?.status ?? 'missing'} cannot be cancelled`,
      )
    }
    // Packing closes the cancellation window. Include packed/dispatched tasks in this check so
    // an order whose status update is still catching up with WMS cannot be refunded prematurely.
    const tasks = await wmsDb.fulfillmentTask.findMany({
      where: { tenantId, orderId, status: { in: ['PENDING', 'PICKING', 'PACKED', 'DISPATCHED'] } },
      select: { id: true, status: true },
    })
    if (tasks.some((task) => task.status === 'PACKED' || task.status === 'DISPATCHED')) {
      throw new ApiError(400, 'An order cannot be cancelled after warehouse packing has begun')
    }
    const open = tasks.filter((task) => task.status === 'PENDING' || task.status === 'PICKING')
    if (open.length > 0) {
      const won = await wmsDb.fulfillmentTask.updateMany({
        where: {
          tenantId,
          id: { in: open.map((t) => t.id) },
          OR: [
            { dispatchClaimedAt: null },
            { dispatchClaimedAt: { lt: new Date(claimedAt.getTime() - DISPATCH_LEASE_MS) } },
          ],
        },
        data: { dispatchClaimedAt: claimedAt },
      })
      claimedTasks = open.map((t) => t.id)
      if (won.count !== open.length) {
        throw new ApiError(
          409,
          'A shipment for this order is being dispatched right now. Try again in a moment.',
        )
      }
      const afterClaim = await orderDb.order.findFirst({ where: { id: orderId, tenantId } })
      const taskStates = await wmsDb.fulfillmentTask.findMany({
        where: { tenantId, id: { in: claimedTasks } },
        select: { status: true },
      })
      if (
        !afterClaim ||
        (afterClaim.status !== 'CANCELLED' && !isOrderCancellationEligible(afterClaim.status)) ||
        taskStates.some((task) => task.status === 'PACKED' || task.status === 'DISPATCHED')
      ) {
        throw new ApiError(
          400,
          'The order entered packing or shipping while cancellation was being processed',
        )
      }
    }

    await step('fulfillment', async () => {
      await wmsFulfillment.cancelFulfillmentByOrder(tenantId, orderId, 'cancel')
    })

    await step('payments', async () => {
      const correlationId = randomUUID()
      const intents = await paymentDb.paymentIntent.findMany({
        where: { tenantId, orderId, status: { in: ['AUTHORIZED', 'CAPTURED'] } },
      })
      for (const intent of intents) {
        if (intent.status === 'AUTHORIZED') {
          await payments.voidIntent(tenantId, intent.id, correlationId)
          continue
        }
        const captured = Number(intent.capturedAmount ?? intent.amount)
        const refundable = +(captured - Number(intent.refundedAmount ?? 0)).toFixed(2)
        if (refundable <= 0.009) continue
        // Take it off amountPaid first, recorded against this payment, then move the money. A crash
        // between the two leaves the books right and the refund still to do; a retry finishes it
        // without taking the amount off twice.
        if (!state.adjusted[intent.id]) {
          await orderDb.$transaction(async (tx) => {
            await tx.order.update({
              where: { id: orderId },
              data: { amountPaid: { decrement: new Prisma.Decimal(refundable) } },
            })
            state.adjusted[intent.id] = refundable.toFixed(2)
            const fresh = await tx.orderSaga.findUniqueOrThrow({ where: { id: saga.id } })
            await tx.orderSaga.update({
              where: { id: saga.id },
              data: {
                compensations: { ...((fresh.compensations as object) ?? {}), cancel: state },
              },
            })
          })
        }
        try {
          await payments.refund(tenantId, intent.id, undefined, correlationId)
        } catch (err) {
          // The refund did not happen: put the amount back so the order is not understated.
          const back = state.adjusted[intent.id]
          delete state.adjusted[intent.id]
          await orderDb
            .$transaction(async (tx) => {
              await tx.order.update({
                where: { id: orderId },
                data: { amountPaid: { increment: new Prisma.Decimal(back) } },
              })
              const fresh = await tx.orderSaga.findUniqueOrThrow({ where: { id: saga.id } })
              await tx.orderSaga.update({
                where: { id: saga.id },
                data: {
                  compensations: { ...((fresh.compensations as object) ?? {}), cancel: state },
                },
              })
            })
            .catch((e) =>
              console.error(
                `[orders] could not restore amountPaid after failed refund on order ${orderId}:`,
                e,
              ),
            )
          throw err
        }
      }
    })

    // The credit memo must only credit cash after its payment refunds have succeeded. The saga's
    // per-intent compensation state makes this amount stable across a retry.
    await step('invoice', async () => {
      const { reconcileCancelledOrderInvoice } = await import('./invoices')
      const refundedAmount = Object.values(state.adjusted).reduce(
        (sum, amount) => sum + Number(amount),
        0,
      )
      await reconcileCancelledOrderInvoice(tenantId, orderId, refundedAmount)
    })

    await step('reservations', async () => {
      await inv.releaseReservationsForOrder(tenantId, orderId)
      const left = await inventoryActiveReservations(tenantId, orderId)
      if (left > 0) throw new Error(`${left} reservation(s) are still active`)
    })

    await step('backorders', async () => {
      await orderDb.backorderLine.updateMany({
        where: { tenantId, orderId, status: { in: ['OPEN', 'PARTIAL'] } },
        data: { status: 'CANCELLED' },
      })
    })

    await step('credit', async () => {
      if (order.paymentMethod !== 'NET_TERMS') return
      const now = await orderDb.order.findUniqueOrThrow({ where: { id: orderId } })
      const refunded = Object.values(state.adjusted).reduce((sum, v) => sum + Number(v), 0)
      const paidBefore = Number(now.amountPaid ?? 0) + refunded
      const exposure = netTermsExposure(Number(now.totalAmount), paidBefore)
      await releaseOrderCredit(tenantId, order.customerId, orderId, exposure)
    })

    await step('voids', async () => {
      // A hold taken after the first pass (a capture racing the cancel) must not survive.
      const leftover = await paymentDb.paymentIntent.findMany({
        where: { tenantId, orderId, status: 'AUTHORIZED' },
      })
      for (const intent of leftover) await payments.voidIntent(tenantId, intent.id, randomUUID())
    })

    // Last: the order only becomes CANCELLED once everything above has been undone.
    const fresh = await orderDb.order.findUniqueOrThrow({ where: { id: orderId } })
    if (fresh.status !== 'CANCELLED') {
      await transitionOrderStatus(tenantId, orderId, 'CANCELLED', {
        cancelledAt: new Date(),
        failureReason: reason,
      })
    }
    await step('invoice-status', async () => {
      const { syncInvoiceFromOrder } = await import('./invoices')
      await syncInvoiceFromOrder(tenantId, orderId)
    })
    state.complete = true
    await persist()
    await orderDb.orderSaga.update({ where: { id: saga.id }, data: { status: 'COMPLETED' } })
    return orderDb.order.findFirstOrThrow({
      where: { id: orderId, tenantId },
      include: { lineItems: true, saga: true },
    })
  } catch (err) {
    // Release the lock so the next cancel attempt can run.
    await orderDb.orderSaga
      .updateMany({
        where: { id: saga0.id, status: CANCEL_LOCK_STATUS as never },
        data: { status: restoreStatus as never },
      })
      .catch(swallowed('order-orchestration.step2'))
    throw err
  } finally {
    if (claimedTasks.length > 0) {
      await wmsDb.fulfillmentTask
        .updateMany({
          where: { tenantId, id: { in: claimedTasks }, dispatchClaimedAt: claimedAt },
          data: { dispatchClaimedAt: null },
        })
        .catch(swallowed('order-orchestration.step3'))
    }
  }
}

async function inventoryActiveReservations(tenantId: string, orderId: string): Promise<number> {
  const { inventoryDb } = await import('./db')
  return inventoryDb.stockReservation.count({ where: { tenantId, orderId, status: 'ACTIVE' } })
}
