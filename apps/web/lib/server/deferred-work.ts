import { randomUUID } from 'node:crypto'
import { orderDb } from './db'

/**
 * Side effects that must happen after money, stock or order state has already changed, but live in
 * another database so they cannot share the transaction: refreshing an invoice after a payment,
 * releasing credit, filling backorders after a receipt, advancing an order after a delivery, and
 * finishing a cancel.
 *
 * Each is tried inline first. If it fails, the failure is logged with a metric and the same work is
 * queued in the posting outbox, where the worker retries it with backoff until it succeeds or goes
 * DEAD (which raises its own alert). Nothing here is ever silently dropped: if even queueing fails,
 * the caller gets an error.
 */
export type WorkKind = 'INVOICE_SYNC' | 'CREDIT_RELEASE' | 'BACKORDER_FILL' | 'DELIVERY_ADVANCE' | 'ORDER_CANCEL'

const WORK_KINDS: readonly string[] = ['INVOICE_SYNC', 'CREDIT_RELEASE', 'BACKORDER_FILL', 'DELIVERY_ADVANCE', 'ORDER_CANCEL']

export function isWorkKind(kind: string): kind is WorkKind {
  return WORK_KINDS.includes(kind)
}

/**
 * Work that re-reads current state each time (a sync, a fill, a cancel) shares one waiting job per
 * source, so a burst of failures queues once. A credit release carries its own amount, so each is its own job.
 */
const COALESCES: Record<WorkKind, boolean> = {
  INVOICE_SYNC: true,
  CREDIT_RELEASE: false,
  BACKORDER_FILL: true,
  DELIVERY_ADVANCE: true,
  ORDER_CANCEL: true,
}

export type WorkRef = {
  tenantId: string
  kind: WorkKind
  sourceType: string
  sourceId: string
  payload?: Record<string, unknown>
}

/** Queues the work for retry. Idempotent for coalescing kinds while one is still waiting. */
export async function queueWork(ref: WorkRef) {
  if (COALESCES[ref.kind]) {
    const waiting = await orderDb.postingJob.findFirst({
      where: {
        tenantId: ref.tenantId,
        kind: ref.kind,
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        status: { in: ['PENDING', 'RUNNING'] },
      },
      select: { id: true },
    })
    if (waiting) return waiting
  }
  const variant = randomUUID()
  const dedupeKey = `${ref.tenantId}:${ref.kind}:${ref.sourceType}:${ref.sourceId}:${variant}`
  return orderDb.postingJob.create({
    data: {
      id: randomUUID(),
      tenantId: ref.tenantId,
      kind: ref.kind,
      sourceType: ref.sourceType,
      sourceId: ref.sourceId,
      variant,
      dedupeKey,
      payload: (ref.payload ?? {}) as never,
    },
  })
}

/**
 * Runs `work` now; if it fails, logs the failure with a metric and queues a retry. Rejects only if
 * the retry could not be queued either, so a failure is never lost.
 */
export async function attemptOrQueue(ref: WorkRef, work: () => Promise<unknown>): Promise<'done' | 'queued'> {
  try {
    await work()
    return 'done'
  } catch (err) {
    console.error(`[deferred] ${ref.kind} for ${ref.sourceType} ${ref.sourceId} (tenant ${ref.tenantId}) failed, queueing a retry:`, err)
    console.error(`[metric] deferred_work_queued 1 kind=${ref.kind}`)
    try {
      await queueWork(ref)
    } catch (queueErr) {
      console.error(`[metric] deferred_work_lost 1 kind=${ref.kind}`)
      throw new Error(
        `${ref.kind} for ${ref.sourceType} ${ref.sourceId} failed and could not be queued for retry: ${
          queueErr instanceof Error ? queueErr.message : String(queueErr)
        }`,
        { cause: err },
      )
    }
    return 'queued'
  }
}

/** Refreshes an invoice from its order after a payment; a failure is queued, never dropped. */
export async function syncInvoiceOrQueue(tenantId: string, orderId: string) {
  return attemptOrQueue({ tenantId, kind: 'INVOICE_SYNC', sourceType: 'Order', sourceId: orderId }, async () => {
    const { syncInvoiceFromOrder } = await import('./invoices')
    await syncInvoiceFromOrder(tenantId, orderId)
  })
}

/** What the worker runs for a queued job. Every handler is safe to run again. */
export async function runWork(ref: WorkRef): Promise<void> {
  const { tenantId, sourceId } = ref
  const payload = (ref.payload ?? {}) as Record<string, unknown>
  switch (ref.kind) {
    case 'INVOICE_SYNC': {
      const { syncInvoiceFromOrder } = await import('./invoices')
      await syncInvoiceFromOrder(tenantId, sourceId)
      return
    }
    case 'CREDIT_RELEASE': {
      const { releaseCreditUsed } = await import('./credit-limit')
      await releaseCreditUsed(tenantId, String(payload.customerId), Number(payload.amount))
      return
    }
    case 'BACKORDER_FILL': {
      const { fillBackordersOnReceipt } = await import('./backorders')
      await fillBackordersOnReceipt(tenantId, String(payload.skuId), String(payload.warehouseId))
      return
    }
    case 'DELIVERY_ADVANCE': {
      const order = await orderDb.order.findFirst({ where: { id: sourceId, tenantId }, select: { status: true } })
      if (!order || order.status === 'DELIVERED') return
      const { onDeliveryStopDelivered } = await import('./order-orchestration')
      await onDeliveryStopDelivered(tenantId, sourceId)
      return
    }
    case 'ORDER_CANCEL': {
      const { cancelOrderWithCompensation } = await import('./order-orchestration')
      await cancelOrderWithCompensation(tenantId, sourceId, String(payload.reason ?? 'Cancelled'))
      return
    }
  }
}
