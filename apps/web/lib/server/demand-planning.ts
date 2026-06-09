import { inventoryDb } from './db'
import * as inv from './inventory'
import { ApiError } from './session'

const OUTBOUND_EVENTS = new Set([
  'STOCK_SHIPPED',
  'STOCK_TRANSFERRED',
  'STOCK_ADJUSTED',
  'ORDER_RESERVED',
])

export async function computeSkuUsage(
  tenantId: string,
  skuId: string,
  warehouseId: string,
  days = 30,
): Promise<{ totalOutbound: number; avgDailyUsage: number; daysSampled: number }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const entries = await inventoryDb.stockLedgerEntry.findMany({
    where: {
      tenantId,
      skuId,
      warehouseId,
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: 'desc' },
    take: 5000,
  })

  let totalOutbound = 0
  for (const e of entries) {
    if (e.quantityDelta >= 0) continue
    if (OUTBOUND_EVENTS.has(e.eventType) || e.eventType.includes('SHIP') || e.eventType.includes('TRANSFER')) {
      totalOutbound += Math.abs(e.quantityDelta)
    }
  }

  const avgDailyUsage = totalOutbound / Math.max(days, 1)
  return { totalOutbound, avgDailyUsage, daysSampled: days }
}

export async function getSkuDemandPlan(
  tenantId: string,
  skuId: string,
  warehouseId?: string,
  days = 30,
) {
  const sku = await inv.findSkuById(tenantId, skuId)
  const level = await inventoryDb.stockLevel.findFirst({
    where: {
      tenantId,
      skuId,
      ...(warehouseId ? { warehouseId } : {}),
      batchId: '',
    },
    orderBy: { quantityAvailable: 'desc' },
  })

  const whId = level?.warehouseId ?? warehouseId
  if (!whId) {
    const warehouses = await inv.listWarehouses(tenantId)
    if (warehouses.length === 0) throw new ApiError(400, 'No warehouse configured')
  }

  const resolvedWh = whId ?? (await inv.listWarehouses(tenantId))[0]!.id
  const usage = await computeSkuUsage(tenantId, skuId, resolvedWh, days)

  const leadTimeDays = level?.leadTimeDays ?? 7
  const reorderPoint = level?.reorderPoint ?? 0
  const onHand = level?.quantityAvailable ?? 0
  const targetStock = Math.ceil(usage.avgDailyUsage * leadTimeDays + reorderPoint)
  const suggestedOrderQty = Math.max(0, targetStock - onHand)
  const staticReorderQty =
    level?.reorderQty && level.reorderQty > 0
      ? level.reorderQty
      : Math.max(1, reorderPoint * 2 || 10)

  return {
    sku: { id: sku.id, code: sku.code, name: sku.name },
    warehouseId: resolvedWh,
    daysSampled: usage.daysSampled,
    totalOutbound: usage.totalOutbound,
    avgDailyUsage: Math.round(usage.avgDailyUsage * 100) / 100,
    leadTimeDays,
    reorderPoint,
    quantityAvailable: onHand,
    targetStock,
    suggestedOrderQty: Math.max(suggestedOrderQty, suggestedOrderQty > 0 ? 1 : 0),
    staticReorderQty,
    method: usage.totalOutbound > 0 ? 'USAGE_FORECAST' : 'STATIC_REORDER',
  }
}

export async function listDemandPlans(tenantId: string, warehouseId?: string, days = 30, limit = 50) {
  const levels = await inventoryDb.stockLevel.findMany({
    where: {
      tenantId,
      batchId: '',
      ...(warehouseId ? { warehouseId } : {}),
    },
    take: limit * 2,
    orderBy: { quantityAvailable: 'asc' },
  })

  const seen = new Set<string>()
  const plans = []
  for (const level of levels) {
    const key = `${level.skuId}:${level.warehouseId}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const plan = await getSkuDemandPlan(tenantId, level.skuId, level.warehouseId, days)
      if (plan.suggestedOrderQty > 0 || plan.quantityAvailable <= plan.reorderPoint) {
        plans.push(plan)
      }
    } catch {
      // skip
    }
    if (plans.length >= limit) break
  }

  return plans.sort((a, b) => b.suggestedOrderQty - a.suggestedOrderQty)
}
