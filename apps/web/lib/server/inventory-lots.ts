import { randomUUID } from 'node:crypto'
import { inventoryDb } from './db'
import { ApiError } from './session'

export async function ensureInventoryLot(
  tenantId: string,
  dto: {
    skuId: string
    warehouseId: string
    batchCode: string
    expiryDate?: Date | null
    supplierId?: string | null
  },
) {
  const code = dto.batchCode.trim()
  if (!code) return null

  return inventoryDb.inventoryLot.upsert({
    where: {
      tenantId_skuId_warehouseId_batchCode: {
        tenantId,
        skuId: dto.skuId,
        warehouseId: dto.warehouseId,
        batchCode: code,
      },
    },
    create: {
      id: randomUUID(),
      tenantId,
      skuId: dto.skuId,
      warehouseId: dto.warehouseId,
      batchCode: code,
      expiryDate: dto.expiryDate ?? null,
      supplierId: dto.supplierId ?? null,
    },
    update: {
      ...(dto.expiryDate !== undefined ? { expiryDate: dto.expiryDate } : {}),
      ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
    },
  })
}

export async function listInventoryLots(tenantId: string, skuId: string, warehouseId?: string) {
  return inventoryDb.inventoryLot.findMany({
    where: {
      tenantId,
      skuId,
      ...(warehouseId ? { warehouseId } : {}),
    },
    orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
  })
}

/** FEFO allocation across batch stock levels for a SKU/warehouse. */
export async function allocateBatchesFefo(
  tenantId: string,
  skuId: string,
  warehouseId: string,
  quantity: number,
): Promise<Array<{ batchId: string; quantity: number; expiryDate: Date | null }>> {
  const lots = await inventoryDb.inventoryLot.findMany({
    where: { tenantId, skuId, warehouseId },
    orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
  })

  const lotOrder = lots.map((l) => l.batchCode)
  const levels = await inventoryDb.stockLevel.findMany({
    where: {
      tenantId,
      skuId,
      warehouseId,
      quantityAvailable: { gt: 0 },
      NOT: { batchId: '' },
    },
  })

  const sorted = [...levels].sort((a, b) => {
    const ai = lotOrder.indexOf(a.batchId ?? '')
    const bi = lotOrder.indexOf(b.batchId ?? '')
    const aRank = ai === -1 ? 999 : ai
    const bRank = bi === -1 ? 999 : bi
    return aRank - bRank
  })

  const allocations: Array<{ batchId: string; quantity: number; expiryDate: Date | null }> = []
  let remaining = quantity

  for (const level of sorted) {
    if (remaining <= 0) break
    const batchId = level.batchId ?? ''
    if (!batchId) continue
    const take = Math.min(remaining, level.quantityAvailable)
    if (take <= 0) continue
    const lot = lots.find((l) => l.batchCode === batchId)
    allocations.push({ batchId, quantity: take, expiryDate: lot?.expiryDate ?? level.expiryDate ?? null })
    remaining -= take
  }

  return allocations
}

export async function getSkuLotTracking(tenantId: string, skuId: string) {
  const sku = await inventoryDb.sKU.findFirst({ where: { id: skuId, tenantId } })
  if (!sku) throw new ApiError(404, 'SKU not found')
  return { trackLot: sku.trackLot, trackSerial: sku.trackSerial }
}

export async function setSkuLotTracking(
  tenantId: string,
  skuId: string,
  patch: { trackLot?: boolean; trackSerial?: boolean },
) {
  const sku = await inventoryDb.sKU.findFirst({ where: { id: skuId, tenantId } })
  if (!sku) throw new ApiError(404, 'SKU not found')
  return inventoryDb.sKU.update({
    where: { id: skuId },
    data: {
      ...(patch.trackLot !== undefined ? { trackLot: patch.trackLot } : {}),
      ...(patch.trackSerial !== undefined ? { trackSerial: patch.trackSerial } : {}),
    },
  })
}
