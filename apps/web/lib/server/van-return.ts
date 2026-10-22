import { dispatchDb, inventoryDb } from './db'
import { ApiError } from './session'
import { adjustStock, transferStock } from './inventory'
import { getVan } from './van-stock'
import { collectsMoneyOnTheRoad, vanSalesFromPod } from './van-rules'
import {
  MANAGER_ROLES,
  buildReturnLines,
  canClose,
  cashCountProblem,
  countsProblem,
  inspectionProblem,
  outstanding,
  overageLines,
  shortageLines,
  type CountInput,
  type ReturnLine,
  type ReturnResolution,
} from './van-return-rules'

/**
 * End of day: the driver counts the van, a picker inspects what comes back, a manager signs off any
 * difference (PLR-168). Stock moves by the guarded transfer; nothing is written off on its own.
 */

type Actor = { userId: string; role: string }
type Cash = { expectedCents: number; countedCents: number }

const asLines = (v: unknown) => v as ReturnLine[]
const asCash = (v: unknown) => v as Cash
const cents = (n: number) => Math.round(n * 100)

/** Cash and cheque sales on the road since this van's last return was counted. */
async function expectedCashCents(tenantId: string, vanId: string, driverId: string | null): Promise<number> {
  if (!driverId) return 0
  const last = await inventoryDb.vanReturn.findFirst({ where: { tenantId, vanId }, orderBy: { createdAt: 'desc' } })
  const since = last?.createdAt ?? new Date(0)
  const stops = await dispatchDb.routeStop.findMany({
    where: { route: { tenantId, driverId, updatedAt: { gte: since } } },
    select: { pod: true },
  })
  let total = 0
  for (const s of stops) {
    for (const sale of vanSalesFromPod(s.pod)) {
      if (new Date(sale.at) > since && collectsMoneyOnTheRoad(sale.paymentMethod)) total += cents(Number(sale.total))
    }
  }
  return total
}

export async function submitVanCount(
  tenantId: string,
  vanId: string,
  body: { counts?: unknown; cashCounted?: unknown },
  actor: Actor,
) {
  const van = await getVan(tenantId, vanId, actor)
  const problem = countsProblem(body.counts) ?? cashCountProblem(body.cashCounted)
  if (problem) throw new ApiError(400, problem)
  const open = await inventoryDb.vanReturn.findFirst({ where: { tenantId, vanId, status: { not: 'CLOSED' } } })
  if (open) throw new ApiError(409, 'This van already has a return in progress')

  const levels = await inventoryDb.stockLevel.findMany({ where: { tenantId, warehouseId: van.id, quantityOnHand: { gt: 0 } } })
  const expectedBySku = new Map<string, number>()
  for (const l of levels) expectedBySku.set(l.skuId, (expectedBySku.get(l.skuId) ?? 0) + l.quantityOnHand)
  const lines = buildReturnLines(
    [...expectedBySku].map(([skuId, quantity]) => ({ skuId, quantity })),
    body.counts as CountInput[],
  )
  const cash: Cash = {
    expectedCents: await expectedCashCents(tenantId, van.id, van.assignedDriverId),
    countedCents: cents(body.cashCounted as number),
  }
  return inventoryDb.vanReturn.create({
    data: {
      tenantId,
      vanId: van.id,
      driverId: van.assignedDriverId,
      status: 'COUNTED',
      lines: lines as never,
      cash: cash as never,
      countedBy: actor.userId,
    },
  })
}

export async function listVanReturns(tenantId: string, vanId: string, actor: Actor) {
  const van = await getVan(tenantId, vanId, actor)
  return inventoryDb.vanReturn.findMany({ where: { tenantId, vanId: van.id }, orderBy: { createdAt: 'desc' }, take: 30 })
}

async function getReturn(tenantId: string, id: string) {
  const r = await inventoryDb.vanReturn.findFirst({ where: { id, tenantId } })
  if (!r) throw new ApiError(404, 'Return not found')
  return r
}

export async function inspectVanReturn(
  tenantId: string,
  returnId: string,
  body: { toWarehouseId?: unknown; lines?: unknown },
  actor: Actor,
) {
  const ret = await getReturn(tenantId, returnId)
  if (ret.status !== 'COUNTED') throw new ApiError(409, 'This return is not waiting for inspection')
  const lines = asLines(ret.lines)
  const problem = inspectionProblem(lines, body.lines)
  if (problem) throw new ApiError(400, problem)
  const over = overageLines(lines)
  const res = (ret.resolution ?? {}) as ReturnResolution
  const unsigned = over.filter((l) => !res.lines?.[l.skuId])
  if (unsigned.length) throw new ApiError(409, 'Some items were counted over what the system expected. A manager must sign those off first')

  const wh = await inventoryDb.warehouse.findFirst({
    where: { id: String(body.toWarehouseId ?? ''), tenantId, kind: 'WAREHOUSE', isActive: true },
  })
  if (!wh) throw new ApiError(400, 'Choose the warehouse the stock is going back to')

  // Only one inspector at a time: the first to flip COUNTED -> INSPECTING gets to move stock.
  const claim = await inventoryDb.vanReturn.updateMany({ where: { id: ret.id, tenantId, status: 'COUNTED' }, data: { status: 'INSPECTING' } })
  if (claim.count !== 1) throw new ApiError(409, 'Someone else is inspecting this return')

  const moved = (ret.moved ?? {}) as Record<string, { good: number; damaged: number }>
  const inspection = body.lines as Array<{ skuId: string; good: number; damaged: number }>
  try {
    for (const i of inspection) {
      const total = i.good + i.damaged
      if (total === 0 || moved[i.skuId]) continue
      await transferStock(tenantId, { skuId: i.skuId, fromWarehouseId: ret.vanId, toWarehouseId: wh.id, quantity: total }, actor.userId)
      if (i.damaged > 0) {
        await adjustStock(
          tenantId,
          {
            skuId: i.skuId,
            warehouseId: wh.id,
            quantityDelta: -i.damaged,
            reason: 'Damaged on van return',
            referenceId: ret.id,
            referenceType: 'VAN_RETURN',
            ledger: true,
          },
          actor.userId,
        )
      }
      moved[i.skuId] = { good: i.good, damaged: i.damaged }
    }
  } catch (e) {
    // Keep what already moved so a retry carries on from there.
    await inventoryDb.vanReturn.update({ where: { id: ret.id }, data: { status: 'COUNTED', moved: moved as never } })
    throw e instanceof ApiError ? new ApiError(409, `${Object.keys(moved).length} items moved before it stopped: ${e.message}`) : e
  }

  const merged = lines.map((l) => ({ ...l, ...(moved[l.skuId] ?? { good: 0, damaged: 0 }) }))
  await inventoryDb.vanReturn.update({
    where: { id: ret.id },
    data: {
      status: 'INSPECTED',
      lines: merged as never,
      moved: moved as never,
      toWarehouseId: wh.id,
      inspectedBy: actor.userId,
      inspectedAt: new Date(),
    },
  })
  return closeIfDone(tenantId, ret.id)
}

/** A manager signs off differences. Shortages are written off the van after inspection; overages are added first. */
export async function resolveVanReturn(
  tenantId: string,
  returnId: string,
  body: { note?: unknown; lines?: unknown; cash?: unknown },
  actor: Actor,
) {
  if (!(MANAGER_ROLES as readonly string[]).includes(actor.role.toUpperCase())) {
    throw new ApiError(403, 'Only a manager can sign off a difference')
  }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (!note) throw new ApiError(400, 'A note is required to sign off a difference')
  const ret = await getReturn(tenantId, returnId)
  if (ret.status === 'CLOSED') throw new ApiError(409, 'This return is already closed')
  if (ret.status === 'INSPECTING') throw new ApiError(409, 'This return is being inspected')
  const lines = asLines(ret.lines)
  const wanted = Array.isArray(body.lines) ? (body.lines as unknown[]).map(String) : []
  const resolution = ((ret.resolution ?? {}) as ReturnResolution) ?? {}
  resolution.lines = resolution.lines ?? {}
  const now = new Date().toISOString()

  for (const skuId of wanted) {
    const line = lines.find((l) => l.skuId === skuId)
    if (!line || line.counted === line.expected) throw new ApiError(400, 'That item has no difference to sign off')
    if (resolution.lines[skuId]) continue
    const short = line.counted < line.expected
    if (short && ret.status !== 'INSPECTED') {
      throw new ApiError(409, 'Shortages are signed off after the inspection, when the missing units are all that is left on the van')
    }
    const quantity = Math.abs(line.counted - line.expected)
    await adjustStock(
      tenantId,
      {
        skuId,
        warehouseId: ret.vanId,
        quantityDelta: short ? -quantity : quantity,
        reason: `${short ? 'Van shortage written off' : 'Overage found on van'}: ${note}`,
        referenceId: ret.id,
        referenceType: 'VAN_RETURN',
        ledger: true,
      },
      actor.userId,
    )
    resolution.lines[skuId] = { action: short ? 'WRITE_OFF' : 'FOUND', quantity, by: actor.userId, at: now, note }
  }
  if (body.cash === true) resolution.cash = { by: actor.userId, at: now, note }

  await inventoryDb.vanReturn.update({ where: { id: ret.id }, data: { resolution: resolution as never } })
  return closeIfDone(tenantId, ret.id)
}

async function closeIfDone(tenantId: string, id: string) {
  const ret = await getReturn(tenantId, id)
  const res = (ret.resolution ?? null) as ReturnResolution | null
  if (canClose(ret.status, asLines(ret.lines), asCash(ret.cash), res)) {
    return inventoryDb.vanReturn.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), resolvedBy: res?.cash?.by ?? ret.inspectedBy } })
  }
  return { ...ret, outstanding: outstanding(asLines(ret.lines), asCash(ret.cash), res), shortages: shortageLines(asLines(ret.lines)).length }
}
