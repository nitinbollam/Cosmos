import { randomUUID } from 'node:crypto'
import { wmsDb } from './db'
import { inventoryDb } from './db'
import * as inv from './inventory'
import { ApiError } from './session'
import { recordLaborEvent } from './wms-labor'

export async function suggestPutawayBin(tenantId: string, warehouseId: string, skuId: string) {
  const skuLevel = await inventoryDb.stockLevel.findFirst({
    where: { tenantId, skuId, warehouseId, locationId: { not: null } },
    orderBy: { updatedAt: 'desc' },
  })
  if (skuLevel?.locationId) {
    const bin = await inventoryDb.binLocation.findFirst({
      where: { id: skuLevel.locationId, tenantId, warehouseId, isActive: true },
    })
    if (bin) return { binId: bin.id, binCode: bin.code, reason: 'existing_sku_location' }
  }

  const emptyBin = await inventoryDb.binLocation.findFirst({
    where: { tenantId, warehouseId, isActive: true },
    orderBy: { code: 'asc' },
  })
  if (emptyBin) return { binId: emptyBin.id, binCode: emptyBin.code, reason: 'default_empty_bin' }

  return { binId: null, binCode: null, reason: 'no_bin' }
}

export async function createPutawayTaskFromReceiving(
  tenantId: string,
  receivingSessionId: string,
  warehouseId: string,
  items: Array<{ skuId: string; batchId?: string | null; quantity: number }>,
) {
  const lines = []
  for (const item of items) {
    const suggestion = await suggestPutawayBin(tenantId, warehouseId, item.skuId)
    lines.push({
      skuId: item.skuId,
      batchId: item.batchId ?? null,
      quantity: item.quantity,
      suggestedBinId: suggestion.binId,
      suggestedBinCode: suggestion.binCode,
    })
  }

  return wmsDb.putawayTask.create({
    data: {
      id: randomUUID(),
      tenantId,
      warehouseId,
      receivingSessionId,
      status: 'PENDING',
      lines: { create: lines },
    },
    include: { lines: true },
  })
}

export async function listPutawayTasks(tenantId: string, warehouseId?: string, status?: string) {
  return wmsDb.putawayTask.findMany({
    where: {
      tenantId,
      ...(warehouseId ? { warehouseId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
}

export async function confirmPutawayLine(
  tenantId: string,
  taskId: string,
  lineId: string,
  dto: { actualBinId?: string; actualBinCode?: string; performedBy: string },
) {
  const task = await wmsDb.putawayTask.findFirst({
    where: { id: taskId, tenantId },
    include: { lines: true },
  })
  if (!task) throw new ApiError(404, 'Putaway task not found')

  const line = task.lines.find((l) => l.id === lineId)
  if (!line) throw new ApiError(404, 'Putaway line not found')

  const binId = dto.actualBinId ?? line.suggestedBinId
  let binCode = dto.actualBinCode ?? line.suggestedBinCode
  if (binId && !binCode) {
    const bin = await inventoryDb.binLocation.findFirst({ where: { id: binId, tenantId } })
    binCode = bin?.code ?? null
  }

  const batchKey = line.batchId ?? ''
  const level = await inventoryDb.stockLevel.findFirst({
    where: {
      tenantId,
      skuId: line.skuId,
      warehouseId: task.warehouseId,
      batchId: batchKey,
    },
  })
  if (level) {
    await inventoryDb.stockLevel.update({
      where: { id: level.id },
      data: { locationId: binId ?? null },
    })
  } else {
    await inv.ensureStockLevel(tenantId, {
      skuId: line.skuId,
      warehouseId: task.warehouseId,
      locationId: binId ?? undefined,
    })
  }

  if (line.batchId) {
    await inventoryDb.stockLevel.updateMany({
      where: {
        tenantId,
        skuId: line.skuId,
        warehouseId: task.warehouseId,
        batchId: line.batchId,
      },
      data: { locationId: binId ?? null },
    })
  }

  await wmsDb.putawayLine.update({
    where: { id: lineId },
    data: {
      status: 'PUTAWAY',
      actualBinId: binId,
      actualBinCode: binCode,
    },
  })

  const openLines = task.lines.filter((l) => l.id !== lineId && l.status === 'PENDING').length
  await wmsDb.putawayTask.update({
    where: { id: taskId },
    data: { status: openLines === 0 ? 'COMPLETED' : 'IN_PROGRESS' },
  })

  await recordLaborEvent(tenantId, {
    userId: dto.performedBy,
    eventType: 'PUTAWAY',
    referenceId: lineId,
    quantity: line.quantity,
    warehouseId: task.warehouseId,
  })

  return { taskId, lineId, binCode }
}
