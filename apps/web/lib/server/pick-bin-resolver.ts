import { inventoryDb } from './db'

function pairKey(skuId: string, warehouseId: string) {
  return `${skuId}:${warehouseId}`
}

/** Maps skuId+warehouseId to a bin code from stock level location assignments. */
export async function resolvePickBinCodes(
  tenantId: string,
  lines: Array<{ skuId: string; warehouseId: string }>,
): Promise<Map<string, string>> {
  if (lines.length === 0) return new Map()

  const skuIds = [...new Set(lines.map((l) => l.skuId))]
  const warehouseIds = [...new Set(lines.map((l) => l.warehouseId))]

  const stockLevels = await inventoryDb.stockLevel.findMany({
    where: {
      tenantId,
      skuId: { in: skuIds },
      warehouseId: { in: warehouseIds },
      quantityAvailable: { gt: 0 },
      locationId: { not: null },
    },
  })

  const locationIds = [...new Set(stockLevels.map((s) => s.locationId).filter(Boolean) as string[])]
  const bins =
    locationIds.length > 0
      ? await inventoryDb.binLocation.findMany({ where: { tenantId, id: { in: locationIds } } })
      : []
  const binById = new Map(bins.map((b) => [b.id, b.code]))

  const map = new Map<string, string>()
  for (const line of lines) {
    const key = pairKey(line.skuId, line.warehouseId)
    if (map.has(key)) continue

    const level = stockLevels
      .filter((s) => s.skuId === line.skuId && s.warehouseId === line.warehouseId && s.locationId)
      .sort((a, b) => b.quantityAvailable - a.quantityAvailable)[0]

    if (!level?.locationId) continue
    map.set(key, binById.get(level.locationId) ?? level.locationId)
  }
  return map
}

export async function enrichPickItemsWithBins<
  T extends { skuId: string; warehouseId: string },
>(tenantId: string, items: T[]): Promise<Array<T & { binCode?: string }>> {
  if (items.length === 0) return []
  const binCodes = await resolvePickBinCodes(tenantId, items)
  return items.map((item) => ({
    ...item,
    binCode: binCodes.get(pairKey(item.skuId, item.warehouseId)),
  }))
}
