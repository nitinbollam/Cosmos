import { inventoryDb } from './db'
import { ApiError } from './session'

export async function listBinLocations(tenantId: string, warehouseId: string) {
  return inventoryDb.binLocation.findMany({
    where: { tenantId, warehouseId, isActive: true },
    orderBy: { code: 'asc' },
  })
}

export async function createBinLocation(
  tenantId: string,
  dto: { warehouseId: string; code: string; aisle?: string; zone?: string },
) {
  if (!dto.code.trim()) throw new ApiError(400, 'code required')
  const wh = await inventoryDb.warehouse.findFirst({ where: { id: dto.warehouseId, tenantId } })
  if (!wh) throw new ApiError(404, 'Warehouse not found')

  return inventoryDb.binLocation.create({
    data: {
      tenantId,
      warehouseId: dto.warehouseId,
      code: dto.code.trim().toUpperCase(),
      aisle: dto.aisle?.trim(),
      zone: dto.zone?.trim(),
    },
  })
}

export async function deleteBinLocation(tenantId: string, id: string) {
  const row = await inventoryDb.binLocation.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Bin not found')
  await inventoryDb.binLocation.update({ where: { id }, data: { isActive: false } })
  return { deleted: true }
}
