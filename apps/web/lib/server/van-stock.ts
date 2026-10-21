import { crmDb, inventoryDb } from './db'
import { ApiError } from './session'
import { transferStock } from './inventory'
import { normalizeState, vanLinesProblem, type VanLine } from './van-rules'
import { isDriverRole } from './driver-scope'

/**
 * A van is a warehouse of kind VEHICLE that rides with one driver (PLR-167). Stock moves on and
 * off it with the same guarded transfer every other move uses, so the stock ledger shows each move
 * and available can never go negative. A manifest records each load or unload with who did it.
 */

type Actor = { userId: string; role: string }

export async function createVan(
  tenantId: string,
  input: { name?: unknown; code?: unknown; driverId?: unknown; stateCode?: unknown },
) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : ''
  const driverId = typeof input.driverId === 'string' ? input.driverId : ''
  const stateCode = normalizeState(typeof input.stateCode === 'string' ? input.stateCode : null)
  if (!name || !code) throw new ApiError(400, 'A van needs a name and a code')
  if (!driverId) throw new ApiError(400, 'A van needs a driver')
  if (!stateCode) throw new ApiError(400, 'A van needs a two-letter state')
  const taken = await inventoryDb.warehouse.findFirst({
    where: { tenantId, kind: 'VEHICLE', assignedDriverId: driverId, isActive: true },
  })
  if (taken) throw new ApiError(409, 'This driver already has a van')
  const clash = await inventoryDb.warehouse.findFirst({ where: { tenantId, code } })
  if (clash) throw new ApiError(409, 'That code is already used')
  return inventoryDb.warehouse.create({
    data: { tenantId, name, code, address: {}, kind: 'VEHICLE', assignedDriverId: driverId, stateCode, isDefault: false },
  })
}

export async function getVan(tenantId: string, vanId: string, actor: Actor) {
  const van = await inventoryDb.warehouse.findFirst({ where: { id: vanId, tenantId, kind: 'VEHICLE' } })
  // 404 rather than 403 so a driver cannot confirm another driver's van exists.
  if (!van || (isDriverRole(actor.role) && van.assignedDriverId !== actor.userId)) throw new ApiError(404, 'Van not found')
  return van
}

export async function listVans(tenantId: string, actor: Actor) {
  return inventoryDb.warehouse.findMany({
    where: {
      tenantId,
      kind: 'VEHICLE',
      isActive: true,
      ...(isDriverRole(actor.role) ? { assignedDriverId: actor.userId } : {}),
    },
    orderBy: { name: 'asc' },
  })
}

/** What is on the van right now. */
export async function getVanInventory(tenantId: string, vanId: string, actor: Actor) {
  const van = await getVan(tenantId, vanId, actor)
  const levels = await inventoryDb.stockLevel.findMany({
    where: { tenantId, warehouseId: van.id, quantityOnHand: { gt: 0 } },
  })
  const skus = await inventoryDb.sKU.findMany({
    where: { tenantId, id: { in: levels.map((l) => l.skuId) } },
    select: { id: true, code: true, name: true },
  })
  const byId = new Map(skus.map((s) => [s.id, s]))
  return {
    van,
    items: levels
      .map((l) => ({
        skuId: l.skuId,
        code: byId.get(l.skuId)?.code ?? null,
        name: byId.get(l.skuId)?.name ?? null,
        onHand: l.quantityOnHand,
        available: l.quantityAvailable,
      }))
      .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')),
  }
}

async function moveLines(
  tenantId: string,
  van: { id: string; assignedDriverId: string | null },
  kind: 'LOAD' | 'UNLOAD',
  warehouseId: string,
  lines: VanLine[],
  actor: Actor,
  note?: string,
) {
  const problem = vanLinesProblem(lines)
  if (problem) throw new ApiError(400, problem)
  const wh = await inventoryDb.warehouse.findFirst({ where: { id: warehouseId, tenantId, kind: 'WAREHOUSE', isActive: true } })
  if (!wh) throw new ApiError(400, 'Choose a warehouse to move stock to or from')

  const moved: VanLine[] = []
  let failure: unknown = null
  for (const l of lines) {
    try {
      await transferStock(
        tenantId,
        {
          skuId: l.skuId,
          quantity: l.quantity,
          fromWarehouseId: kind === 'LOAD' ? wh.id : van.id,
          toWarehouseId: kind === 'LOAD' ? van.id : wh.id,
        },
        actor.userId,
      )
      moved.push({ skuId: l.skuId, quantity: l.quantity })
    } catch (e) {
      failure = e
      break
    }
  }
  // What did move is on the manifest even when a later line failed, so the paper matches the stock.
  const manifest = moved.length
    ? await inventoryDb.vanManifest.create({
        data: {
          tenantId,
          vanId: van.id,
          driverId: van.assignedDriverId,
          kind,
          lines: moved as never,
          note: note?.trim() || null,
          createdBy: actor.userId,
        },
      })
    : null
  if (failure) {
    const why = failure instanceof ApiError ? failure.message : 'a stock move failed'
    throw new ApiError(409, `${moved.length} of ${lines.length} lines moved before it stopped: ${why}`)
  }
  return { manifest, moved }
}

export async function loadVan(
  tenantId: string,
  vanId: string,
  body: { fromWarehouseId?: unknown; lines?: unknown; note?: unknown },
  actor: Actor,
) {
  const van = await getVan(tenantId, vanId, actor)
  if (!van.isActive) throw new ApiError(409, 'This van is not in service')
  return moveLines(tenantId, van, 'LOAD', String(body.fromWarehouseId ?? ''), body.lines as VanLine[], actor, typeof body.note === 'string' ? body.note : undefined)
}

export async function unloadVan(
  tenantId: string,
  vanId: string,
  body: { toWarehouseId?: unknown; lines?: unknown; note?: unknown },
  actor: Actor,
) {
  const van = await getVan(tenantId, vanId, actor)
  return moveLines(tenantId, van, 'UNLOAD', String(body.toWarehouseId ?? ''), body.lines as VanLine[], actor, typeof body.note === 'string' ? body.note : undefined)
}

export async function setVanSalesApproved(tenantId: string, customerId: string, approved: boolean) {
  const res = await crmDb.customer.updateMany({ where: { id: customerId, tenantId }, data: { vanSalesApproved: approved } })
  if (res.count !== 1) throw new ApiError(404, 'Customer not found')
  return { customerId, vanSalesApproved: approved }
}
