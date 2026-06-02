import type { CycleCountType } from '@/generated/prisma-wms'
import { randomUUID } from 'node:crypto'
import { wmsDb } from './db'
import * as inv from './inventory'
import { computeCycleCountDelta, cycleCountLineNeedsAdjustment } from './cycle-count-adjust'
import { ApiError } from './session'

type InvLevelRow = {
  skuId: string
  locationId?: string | null
  batchId?: string | null
  quantityOnHand: number
}

function selectLinesForCountType(levels: InvLevelRow[], type: CycleCountType) {
  const nonBatch = levels.filter((l) => l.batchId == null || l.batchId === '')
  const keyed = nonBatch.map((l) => ({
    skuId: l.skuId,
    locationLabel: l.locationId?.trim() || null,
    systemQty: Math.max(0, Number(l.quantityOnHand) || 0),
  }))

  if (type === 'FULL') return keyed.slice(0, 500)
  if (type === 'ABC') {
    const sorted = [...keyed].sort((a, b) => b.systemQty - a.systemQty)
    return sorted.slice(0, Math.min(100, sorted.length))
  }
  const shuffled = [...keyed]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, Math.min(40, shuffled.length))
}

export async function listCycleCounts(tenantId: string) {
  const rows = await wmsDb.cycleCount.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { _count: { select: { lines: true } } },
  })
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const lineAgg = await wmsDb.cycleCountLine.findMany({
    where: { countId: { in: ids } },
    select: { countId: true, systemQty: true, countedQty: true },
  })
  const vmap = new Map<string, number>()
  for (const l of lineAgg) {
    if (l.countedQty == null) continue
    if (l.countedQty === l.systemQty) continue
    vmap.set(l.countId, (vmap.get(l.countId) ?? 0) + 1)
  }
  return rows.map((r) => ({
    ...r,
    varianceItemsCount: vmap.get(r.id) ?? 0,
  }))
}

export async function createCycleCount(
  tenantId: string,
  userId: string,
  dto: { warehouseId: string; type: CycleCountType; scheduledFor?: string | null },
) {
  const scheduled =
    dto.scheduledFor && dto.scheduledFor.length > 0 ? new Date(dto.scheduledFor) : null
  const count = await wmsDb.cycleCount.create({
    data: {
      tenantId,
      warehouseId: dto.warehouseId,
      type: dto.type,
      status: 'DRAFT',
      scheduledFor: scheduled,
      createdBy: userId,
    },
  })

  const levels = await inv.getStockLevels(tenantId, { warehouseId: dto.warehouseId })
  const picks = selectLinesForCountType(levels as InvLevelRow[], dto.type)
  if (picks.length > 0) {
    await wmsDb.cycleCountLine.createMany({
      data: picks.map((p) => ({
        countId: count.id,
        skuId: p.skuId,
        locationLabel: p.locationLabel,
        systemQty: p.systemQty,
        countedQty: null,
      })),
    })
    await wmsDb.cycleCount.update({
      where: { id: count.id },
      data: { status: 'IN_PROGRESS' },
    })
  }

  return getCycleCount(tenantId, count.id)
}

export async function getCycleCount(tenantId: string, id: string) {
  const row = await wmsDb.cycleCount.findFirst({
    where: { id, tenantId },
    include: { lines: { orderBy: { id: 'asc' } } },
  })
  if (!row) throw new ApiError(404, 'Cycle count not found')
  return row
}

export async function importCycleLineCounts(
  tenantId: string,
  countId: string,
  rows: Array<{ skuId?: string; skuCode?: string; locationLabel?: string; countedQty: number }>,
) {
  const row = await getCycleCount(tenantId, countId)
  if (row.status !== 'IN_PROGRESS') {
    throw new ApiError(400, 'Counted quantities can only be imported while count is in progress')
  }

  const codeToSkuId = new Map<string, string>()
  for (const importRow of rows) {
    if (importRow.skuId || !importRow.skuCode?.trim()) continue
    const code = importRow.skuCode.trim().toLowerCase()
    if (codeToSkuId.has(code)) continue
    try {
      const sku = await inv.findSkuByCode(tenantId, importRow.skuCode.trim())
      codeToSkuId.set(code, sku.id)
    } catch {
      /* unresolved */
    }
  }

  let updated = 0
  const errors: Array<{ row: number; message: string }> = []
  for (let index = 0; index < rows.length; index++) {
    const importRow = rows[index]
    const rowNum = index + 2
    let skuId = importRow.skuId?.trim()
    if (!skuId && importRow.skuCode?.trim()) {
      skuId = codeToSkuId.get(importRow.skuCode.trim().toLowerCase())
    }
    if (!skuId) {
      errors.push({ row: rowNum, message: 'skuId or skuCode is required and must match a line' })
      continue
    }

    const location = importRow.locationLabel?.trim() || null
    const line = row.lines.find(
      (candidate) =>
        candidate.skuId === skuId &&
        (candidate.locationLabel?.trim() || null) === location,
    )
    if (!line) {
      errors.push({ row: rowNum, message: 'No matching cycle count line for SKU/location' })
      continue
    }

    await wmsDb.cycleCountLine.update({
      where: { id: line.id },
      data: { countedQty: importRow.countedQty },
    })
    updated++
  }

  return { updated, failed: errors.length, errors }
}

export async function updateCycleLineCountedQty(
  tenantId: string,
  countId: string,
  lineId: string,
  countedQty: number,
) {
  const row = await getCycleCount(tenantId, countId)
  if (row.status !== 'IN_PROGRESS') {
    throw new ApiError(400, 'Counted quantities can only be edited while count is in progress')
  }
  const line = row.lines.find((l) => l.id === lineId)
  if (!line) throw new ApiError(404, 'Line not found')
  return wmsDb.cycleCountLine.update({
    where: { id: lineId },
    data: { countedQty },
  })
}

export async function submitCycleCountForApproval(tenantId: string, id: string) {
  const row = await getCycleCount(tenantId, id)
  if (row.status !== 'DRAFT' && row.status !== 'IN_PROGRESS') {
    throw new ApiError(400, 'Count must be draft or in progress to submit')
  }
  if (row.lines.length === 0) {
    throw new ApiError(400, 'Cannot submit a count with no lines')
  }
  const missing = row.lines.filter((l) => l.countedQty == null)
  if (missing.length > 0) {
    throw new ApiError(400, `All lines must have counted quantities (${missing.length} missing)`)
  }
  return wmsDb.cycleCount.update({
    where: { id: row.id },
    data: { status: 'PENDING_APPROVAL' },
    include: { lines: true },
  })
}

export async function approveCycleCount(tenantId: string, id: string, performedBy: string) {
  const row = await getCycleCount(tenantId, id)
  if (row.status === 'COMPLETED') {
    return {
      count: row,
      adjustmentsPosted: 0,
      skipped: row.lines.length,
      errors: [] as string[],
    }
  }
  if (row.status !== 'PENDING_APPROVAL') {
    throw new ApiError(400, 'Only counts pending approval can be posted')
  }
  if (row.lines.length === 0) {
    throw new ApiError(400, 'Cannot approve a count with no lines')
  }

  const missing = row.lines.filter((l) => l.countedQty == null)
  if (missing.length > 0) {
    throw new ApiError(400, `All lines must have counted quantities (${missing.length} missing)`)
  }

  const correlationId = randomUUID()
  let adjustmentsPosted = 0
  let skipped = 0
  const errors: string[] = []

  for (const line of row.lines) {
    const countedQty = line.countedQty!
    if (!cycleCountLineNeedsAdjustment(line.systemQty, countedQty)) {
      skipped++
      continue
    }

    const quantityDelta = computeCycleCountDelta(line.systemQty, countedQty)
    try {
      await inv.adjustStock(
        tenantId,
        {
          skuId: line.skuId,
          warehouseId: row.warehouseId,
          quantityDelta,
          batchId: '',
          locationId: line.locationLabel,
          referenceId: row.id,
          referenceType: 'CYCLE_COUNT',
          correlationId,
          reason: `Cycle count ${row.id}`,
        },
        performedBy,
      )
      adjustmentsPosted++
    } catch (e) {
      errors.push(
        `${line.skuId.slice(-8)}: ${e instanceof Error ? e.message : 'adjustment failed'}`,
      )
    }
  }

  if (errors.length > 0) {
    throw new ApiError(400, `Could not post all adjustments: ${errors.join('; ')}`)
  }

  const count = await wmsDb.cycleCount.update({
    where: { id: row.id },
    data: { status: 'COMPLETED' },
    include: { lines: true },
  })

  return { count, adjustmentsPosted, skipped, errors }
}
