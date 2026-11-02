import { randomUUID } from 'node:crypto'
import { wmsDb } from './db'
import { inventoryDb } from './db'
import * as inv from './inventory'
import { ApiError } from './session'
import { recordLaborEvent } from './wms-labor'
import { moveToBin } from './bin-stock'

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
  // Confirming twice (double tap, retry) must not move the stock twice.
  if (line.status === 'PUTAWAY') {
    return { taskId, lineId, binCode: line.actualBinCode, moved: 0, alreadyPutAway: true }
  }

  let binId = dto.actualBinId ?? null
  if (!binId && dto.actualBinCode?.trim()) {
    const byCode = await inventoryDb.binLocation.findFirst({
      where: { tenantId, warehouseId: task.warehouseId, code: dto.actualBinCode.trim(), isActive: true },
      select: { id: true },
    })
    if (!byCode) throw new ApiError(400, `No active bin ${dto.actualBinCode.trim()} in this warehouse`)
    binId = byCode.id
  }
  binId ??= line.suggestedBinId
  if (!binId) {
    // A warehouse with no bins has nowhere to put stock: the line is done and the stock stays unbinned.
    const hasBins = await inventoryDb.binLocation.count({ where: { tenantId, warehouseId: task.warehouseId, isActive: true } })
    if (hasBins > 0) throw new ApiError(400, 'Choose a bin to put this away in')
    await wmsDb.putawayLine.updateMany({ where: { id: lineId, taskId, status: 'PENDING' }, data: { status: 'PUTAWAY' } })
    const open = await wmsDb.putawayLine.count({ where: { taskId, status: 'PENDING' } })
    await wmsDb.putawayTask.update({ where: { id: taskId }, data: { status: open === 0 ? 'COMPLETED' : 'IN_PROGRESS' } })
    return { taskId, lineId, binCode: null, moved: 0 }
  }
  const bin = await inventoryDb.binLocation.findFirst({
    where: { id: binId, tenantId, warehouseId: task.warehouseId, isActive: true },
    select: { code: true },
  })
  if (!bin) throw new ApiError(400, 'That bin is not an active bin in this warehouse')

  // Receiving creates the stock level; make sure an unbatched one exists for older tasks.
  if (!line.batchId) await inv.ensureStockLevel(tenantId, { skuId: line.skuId, warehouseId: task.warehouseId })
  // Only this line's received quantity goes into the bin; the rest of the stock stays where it is (ticket 46).
  // The ledger rows carry the line id, so a retry after a failure below finds the move already done.
  const move = await moveToBin(tenantId, {
    skuId: line.skuId,
    warehouseId: task.warehouseId,
    batchId: line.batchId ?? '',
    toBinId: binId,
    quantity: line.quantity,
    referenceType: 'PUTAWAY_LINE',
    referenceId: lineId,
    performedBy: dto.performedBy,
    allowPartial: true,
  })

  const claimed = await wmsDb.putawayLine.updateMany({
    where: { id: lineId, taskId, status: 'PENDING' },
    data: { status: 'PUTAWAY', actualBinId: binId, actualBinCode: bin.code },
  })

  const openLines = await wmsDb.putawayLine.count({ where: { taskId, status: 'PENDING' } })
  await wmsDb.putawayTask.update({
    where: { id: taskId },
    data: { status: openLines === 0 ? 'COMPLETED' : 'IN_PROGRESS' },
  })

  if (claimed.count === 1) {
    await recordLaborEvent(tenantId, {
      userId: dto.performedBy,
      eventType: 'PUTAWAY',
      referenceId: lineId,
      quantity: move.moved,
      warehouseId: task.warehouseId,
    })
  }

  return { taskId, lineId, binCode: bin.code, moved: move.moved, binQuantity: move.binQuantity, unbinned: move.unbinned }
}
