import { inventoryDb, orderDb } from './db'
import { releaseReservation } from './inventory'

/**
 * Safety net for reconciliation rule R6: an ACTIVE stock reservation must not outlive its order.
 * Finds ACTIVE reservations whose order is CANCELLED or FAILED, releases each through the normal
 * release path, and logs what it fixed. A reservation it cannot release is logged and left for the
 * next run. Cancel and the order saga already release reservations; this catches whatever slipped past.
 */
export async function releaseReservationsOfDeadOrders(opts: { limit?: number; tenantId?: string } = {}) {
  const rows = await inventoryDb.stockReservation.findMany({
    where: { status: 'ACTIVE', ...(opts.tenantId ? { tenantId: opts.tenantId } : {}) },
    select: { id: true, tenantId: true, orderId: true, skuId: true, quantity: true },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 500,
  })
  if (rows.length === 0) return { checked: 0, released: 0, failed: 0 }

  const orders = await orderDb.order.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.orderId))] } },
    select: { id: true, tenantId: true, status: true },
  })
  const dead = new Set(orders.filter((o) => o.status === 'CANCELLED' || o.status === 'FAILED').map((o) => `${o.tenantId}:${o.id}`))

  let released = 0
  let failed = 0
  for (const r of rows) {
    if (!dead.has(`${r.tenantId}:${r.orderId}`)) continue
    try {
      await releaseReservation(r.tenantId, r.id)
      released++
      console.warn(`[reservations] released leaked reservation ${r.id} (${r.quantity} of ${r.skuId}) held by dead order ${r.orderId}`)
    } catch (err) {
      failed++
      console.error(`[reservations] could not release reservation ${r.id} for dead order ${r.orderId}:`, err)
    }
  }
  return { checked: rows.length, released, failed }
}
