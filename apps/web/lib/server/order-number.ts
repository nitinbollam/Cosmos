import { orderDb } from './db'

/** The first order a tenant creates is ORD-1001. */
export const ORDER_NUMBER_START = 1000

/** What staff and buyers see for an order, e.g. ORD-1042. */
export function formatOrderNumber(orderNumber: number): string {
  return `ORD-${orderNumber}`
}

/** The label for an order record: its number, or the tail of its id until it has one. */
export function orderCodeOf(order: { id: string; orderNumber: number | null }): string {
  return order.orderNumber != null ? formatOrderNumber(order.orderNumber) : `ORD-${order.id.slice(-6).toUpperCase()}`
}

/**
 * Hands out the next number for a tenant. The upsert increments a single counter row, so two orders
 * created at the same moment cannot receive the same number. A number is lost (a gap) if the order
 * insert that follows fails; gaps are harmless, duplicates are not.
 */
export async function allocateOrderNumber(tenantId: string): Promise<number> {
  const row = await orderDb.orderCounter.upsert({
    where: { tenantId },
    create: { tenantId, lastNumber: ORDER_NUMBER_START + 1 },
    update: { lastNumber: { increment: 1 } },
  })
  return row.lastNumber
}

/** Order numbers for a set of order ids (orders without one are absent from the map). */
export async function orderNumberMap(tenantId: string, orderIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(orderIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const rows = await orderDb.order.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, orderNumber: true },
  })
  const out = new Map<string, number>()
  for (const r of rows) if (r.orderNumber != null) out.set(r.id, r.orderNumber)
  return out
}

/** Reads a search box value like "1042", "ord-1042" or "#ORD-1042" as an order number, or null. */
export function parseOrderNumberQuery(input: string): number | null {
  const m = /^#?(?:ord-?)?(\d{1,9})$/i.exec(input.trim())
  return m ? Number(m[1]) : null
}

/**
 * Gives every order that has no number one, oldest first, continuing after the tenant's counter.
 * Safe to run repeatedly and while the app is live: each number comes from the same atomic counter
 * that new orders use, and only orders still without a number are touched.
 */
export async function backfillOrderNumbers(opts?: { tenantId?: string; batchSize?: number }): Promise<{ assigned: number; tenants: number }> {
  const batchSize = opts?.batchSize ?? 200
  const tenantRows = await orderDb.order.findMany({
    where: { orderNumber: null, ...(opts?.tenantId ? { tenantId: opts.tenantId } : {}) },
    distinct: ['tenantId'],
    select: { tenantId: true },
  })
  let assigned = 0
  for (const { tenantId } of tenantRows) {
    for (;;) {
      const batch = await orderDb.order.findMany({
        where: { tenantId, orderNumber: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      })
      if (batch.length === 0) break
      for (const o of batch) {
        const n = await allocateOrderNumber(tenantId)
        // The guard keeps a concurrent run from numbering the same order twice.
        const res = await orderDb.order.updateMany({ where: { id: o.id, tenantId, orderNumber: null }, data: { orderNumber: n } })
        if (res.count === 1) assigned++
      }
    }
  }
  return { assigned, tenants: tenantRows.length }
}
