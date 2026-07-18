import { forecastDemandUsage } from '@pleros/analytics-engine'
import { inventoryDb } from './db'
import * as inv from './inventory'
import { ApiError } from './session'

const OUTBOUND_EVENTS = new Set([
  'STOCK_SHIPPED',
  'STOCK_TRANSFERRED',
  'STOCK_ADJUSTED',
  'ORDER_RESERVED',
])

const DEFAULT_LOOKBACK_DAYS = 70

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function buildDailyOutboundSeries(
  entries: Array<{ occurredAt: Date; quantityDelta: number; eventType: string }>,
  days: number,
): { history: Array<{ date: string; quantity: number }>; totalOutbound: number } {
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  const buckets = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setUTCDate(d.getUTCDate() - i)
    buckets.set(dayKey(d), 0)
  }

  let totalOutbound = 0
  for (const e of entries) {
    if (e.quantityDelta >= 0) continue
    if (!(OUTBOUND_EVENTS.has(e.eventType) || e.eventType.includes('SHIP') || e.eventType.includes('TRANSFER'))) {
      continue
    }
    const qty = Math.abs(e.quantityDelta)
    totalOutbound += qty
    const key = dayKey(new Date(e.occurredAt))
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + qty)
    }
  }

  const history = [...buckets.entries()].map(([date, quantity]) => ({ date, quantity }))
  return { history, totalOutbound }
}

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
  days = DEFAULT_LOOKBACK_DAYS,
) {
  const lookback = Math.min(90, Math.max(30, days))
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
  const since = new Date(Date.now() - lookback * 24 * 60 * 60 * 1000)
  const entries = await inventoryDb.stockLedgerEntry.findMany({
    where: {
      tenantId,
      skuId,
      warehouseId: resolvedWh,
      occurredAt: { gte: since },
    },
    orderBy: { occurredAt: 'asc' },
    take: 8000,
  })

  const { history, totalOutbound } = buildDailyOutboundSeries(entries, lookback)
  const leadTimeDays = level?.leadTimeDays ?? 7
  const reorderPoint = level?.reorderPoint ?? 0
  const onHand = level?.quantityAvailable ?? 0
  const staticReorderQty =
    level?.reorderQty && level.reorderQty > 0
      ? level.reorderQty
      : Math.max(1, reorderPoint * 2 || 10)

  const seasonalPeriod = lookback >= 56 ? 7 : null
  const forecast = forecastDemandUsage({
    history,
    leadTimeDays,
    safetyStock: reorderPoint,
    horizonDays: Math.max(leadTimeDays, 7),
    seasonalPeriod,
  })

  const ewmaDailyUsage = forecast.ewmaDailyUsage
  const avgDailyUsage = forecast.avgDailyUsage
  const targetStock =
    forecast.method === 'STATIC_REORDER'
      ? Math.max(staticReorderQty, reorderPoint)
      : forecast.suggestedCoverQty
  const suggestedOrderQty =
    forecast.method === 'STATIC_REORDER'
      ? Math.max(0, staticReorderQty - onHand)
      : Math.max(0, targetStock - onHand)

  let method = forecast.method
  if (method === 'USAGE_EWMA_SEASONAL') method = 'USAGE_EWMA_SEASONAL'
  else if (method.startsWith('USAGE_EWMA')) method = method.includes('SEASONAL') ? 'USAGE_EWMA_SEASONAL' : 'USAGE_EWMA'

  return {
    sku: { id: sku.id, code: sku.code, name: sku.name },
    warehouseId: resolvedWh,
    daysSampled: lookback,
    totalOutbound,
    avgDailyUsage: Math.round(avgDailyUsage * 100) / 100,
    ewmaDailyUsage: Math.round(ewmaDailyUsage * 100) / 100,
    leadTimeDays,
    reorderPoint,
    quantityAvailable: onHand,
    targetStock,
    suggestedOrderQty: Math.max(suggestedOrderQty, suggestedOrderQty > 0 ? 1 : 0),
    staticReorderQty,
    method: totalOutbound > 0 ? method : 'STATIC_REORDER',
    warnings: forecast.warnings,
  }
}

export async function listDemandPlans(tenantId: string, warehouseId?: string, days = DEFAULT_LOOKBACK_DAYS, limit = 50) {
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
