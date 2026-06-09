import { randomUUID } from 'node:crypto'
import { inventoryDb } from './db'
import { ApiError } from './session'

export async function registerSerialUnits(
  tenantId: string,
  dto: {
    skuId: string
    warehouseId: string
    serialNumbers: string[]
    batchId?: string
    locationId?: string
  },
) {
  const sku = await inventoryDb.sKU.findFirst({ where: { id: dto.skuId, tenantId } })
  if (!sku) throw new ApiError(404, 'SKU not found')
  if (!sku.trackSerial) throw new ApiError(400, 'SKU is not serial-tracked')

  const created = []
  for (const raw of dto.serialNumbers) {
    const serialNumber = raw.trim()
    if (!serialNumber) continue
    const row = await inventoryDb.serialUnit.create({
      data: {
        id: randomUUID(),
        tenantId,
        skuId: dto.skuId,
        serialNumber,
        warehouseId: dto.warehouseId,
        locationId: dto.locationId ?? null,
        batchId: dto.batchId ?? null,
        status: 'IN_STOCK',
      },
    })
    created.push(row)
  }
  return created
}

export async function listSerialUnits(tenantId: string, filters?: { skuId?: string; orderId?: string; status?: string }) {
  return inventoryDb.serialUnit.findMany({
    where: {
      tenantId,
      ...(filters?.skuId ? { skuId: filters.skuId } : {}),
      ...(filters?.orderId ? { orderId: filters.orderId } : {}),
      ...(filters?.status ? { status: filters.status as never } : {}),
    },
    orderBy: { receivedAt: 'desc' },
    take: 200,
  })
}

export async function reserveSerialUnits(
  tenantId: string,
  dto: { skuId: string; orderId: string; serialNumbers: string[]; reservationId: string },
) {
  for (const sn of dto.serialNumbers) {
    const unit = await inventoryDb.serialUnit.findFirst({
      where: { tenantId, serialNumber: sn.trim(), skuId: dto.skuId, status: 'IN_STOCK' },
    })
    if (!unit) throw new ApiError(400, `Serial not available: ${sn}`)
    await inventoryDb.serialUnit.update({
      where: { id: unit.id },
      data: { status: 'RESERVED', orderId: dto.orderId, reservationId: dto.reservationId },
    })
  }
}

export async function shipSerialUnits(tenantId: string, orderId: string, serialNumbers: string[]) {
  for (const sn of serialNumbers) {
    await inventoryDb.serialUnit.updateMany({
      where: { tenantId, orderId, serialNumber: sn.trim(), status: 'RESERVED' },
      data: { status: 'SHIPPED' },
    })
  }
}
