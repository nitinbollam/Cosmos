import { inventoryDb } from './db'
import { ApiError } from './session'

/**
 * A purchase order's destination warehouse: where its goods are meant to arrive.
 *
 * It is stored on the requisition (chosen when it is raised) and copied to the PO when the requisition is
 * converted. Receiving starts there by default; a person can still pick another warehouse for one receipt.
 * Warehouses live in the inventory database, so the PO holds the id as a plain column and the checks live here.
 */

export type WarehouseRef = { id: string; name: string; code: string }

/** Refuses a warehouse id that is not an active warehouse (not a van) of this company. */
export async function assertDestinationWarehouse(tenantId: string, warehouseId: string): Promise<void> {
  const row = await inventoryDb.warehouse.findFirst({
    where: { id: warehouseId, tenantId, isActive: true, kind: 'WAREHOUSE' },
    select: { id: true },
  })
  if (!row) throw new ApiError(400, 'Choose one of the company\'s active warehouses as the destination')
}

/** Name and code for a set of warehouse ids (ids that no longer exist are simply absent). */
export async function warehouseRefs(tenantId: string, ids: Array<string | null | undefined>): Promise<Map<string, WarehouseRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return new Map()
  const rows = await inventoryDb.warehouse.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, name: true, code: true },
  })
  return new Map(rows.map((w) => [w.id, w]))
}

/**
 * Which warehouse a receiving session or a receipt starts in: the one a person chose, else the PO's destination,
 * else the company default. Blank values count as not chosen.
 */
export function pickReceivingWarehouse(opts: {
  explicit?: string | null
  poWarehouseId?: string | null
  defaultId?: string | null
}): string | null {
  for (const id of [opts.explicit, opts.poWarehouseId, opts.defaultId]) {
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}
