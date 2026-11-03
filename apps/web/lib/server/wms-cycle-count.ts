import type { CycleCountType } from '@/generated/prisma-wms'
import { randomUUID } from 'node:crypto'
import { inventoryDb, wmsDb } from './db'
import * as inv from './inventory'
import { computeCycleCountDelta, cycleCountLineKey, cycleCountLineNeedsAdjustment } from './cycle-count-adjust'
import { swallowed } from './fire-and-forget'
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

/**
 * A count for the count sheet: each line also carries the SKU code and name and the bin code, so
 * nobody has to read internal ids. Lines store the bin's id as `locationLabel`; a label that is not
 * a known bin id is shown as it is.
 */
export async function getCycleCountSheet(tenantId: string, id: string) {
  const row = await getCycleCount(tenantId, id)
  const skuIds = [...new Set(row.lines.map((l) => l.skuId))]
  const binIds = [...new Set(row.lines.map((l) => l.locationLabel).filter((v): v is string => !!v))]
  const [skus, bins] = await Promise.all([
    skuIds.length
      ? inventoryDb.sKU.findMany({ where: { tenantId, id: { in: skuIds } }, select: { id: true, code: true, name: true } })
      : [],
    binIds.length
      ? inventoryDb.binLocation.findMany({ where: { tenantId, id: { in: binIds } }, select: { id: true, code: true } })
      : [],
  ])
  const skuById = new Map(skus.map((s) => [s.id, s]))
  const binById = new Map(bins.map((b) => [b.id, b.code]))
  return {
    ...row,
    lines: row.lines.map((l) => ({
      ...l,
      skuCode: skuById.get(l.skuId)?.code ?? null,
      skuName: skuById.get(l.skuId)?.name ?? null,
      binCode: l.locationLabel ? (binById.get(l.locationLabel) ?? l.locationLabel) : null,
    })),
  }
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
    data: { status: 'PENDING_APPROVAL', submittedAt: new Date() },
    include: { lines: true },
  })
}

/**
 * How long an approval holds its claim on a count without renewing it. Renewed before each line is posted, so it
 * only has to cover one line; a crashed approval's claim lapses after this and a retry takes over (ticket 49).
 */
const APPROVAL_CLAIM_MS = 60_000

const claimExpiry = () => new Date(Date.now() + APPROVAL_CLAIM_MS)

function claimLost() {
  return new ApiError(409, 'This count is now being approved by another request; try again shortly.')
}

/** Extends this approval's claim; false when another request holds the count now. */
async function renewApprovalClaim(tenantId: string, countId: string, token: string) {
  const renewed = await wmsDb.cycleCount.updateMany({
    where: { id: countId, tenantId, approvalClaimId: token },
    data: { approvalClaimExpiresAt: claimExpiry() },
  })
  return renewed.count === 1
}

/**
 * Records a line's posting, only while this approval still holds the count. The claim row is written first in the
 * same transaction, so a request taking over the count waits for this to commit, then sees a live claim.
 * A posting already recorded is never replaced.
 */
function recordLinePosted(tenantId: string, countId: string, lineId: string, token: string, ledgerEntryId: string) {
  return wmsDb.$transaction(async (tx) => {
    // The line has no tenantId of its own; its count is checked for the tenant here, in the same transaction.
    const held = await tx.cycleCount.updateMany({
      where: { id: countId, tenantId, approvalClaimId: token },
      data: { approvalClaimExpiresAt: claimExpiry() },
    })
    if (held.count !== 1) return false
    await tx.cycleCountLine.updateMany({
      where: { id: lineId, countId, postedLedgerId: null },
      data: { postedLedgerId: ledgerEntryId },
    })
    return true
  })
}

/**
 * Stock postings an approval made for this count before postings carried an idempotency key, less those a person
 * has reviewed and recorded on one of the count's lines (its postedLedgerId).
 */
export async function countLegacyCycleCountPostings(tenantId: string, countId: string) {
  const recorded = await wmsDb.cycleCountLine.findMany({
    where: { countId, postedLedgerId: { not: null } },
    select: { postedLedgerId: true },
  })
  return inventoryDb.stockLedgerEntry.count({
    where: {
      tenantId,
      referenceType: 'CYCLE_COUNT',
      referenceId: countId,
      eventType: 'STOCK_ADJUSTED',
      idempotencyKey: null,
      id: { notIn: recorded.map((l) => l.postedLedgerId!) },
    },
  })
}

function completedApproval(count: Awaited<ReturnType<typeof getCycleCount>>) {
  return {
    count,
    adjustmentsPosted: 0,
    skipped: count.lines.length,
    alreadyPosted: 0,
    errors: [] as string[],
  }
}

export async function approveCycleCount(tenantId: string, id: string, performedBy: string) {
  const row = await getCycleCount(tenantId, id)
  if (row.status === 'COMPLETED') return completedApproval(row)
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

  // One approval at a time, across server instances: the first request to claim the count posts it.
  const token = randomUUID()
  const claimed = await wmsDb.cycleCount.updateMany({
    where: {
      id: row.id,
      tenantId,
      status: 'PENDING_APPROVAL',
      OR: [{ approvalClaimId: null }, { approvalClaimExpiresAt: { lt: new Date() } }],
    },
    data: { approvalClaimId: token, approvalClaimExpiresAt: claimExpiry() },
  })
  if (claimed.count !== 1) {
    const current = await getCycleCount(tenantId, id)
    if (current.status === 'COMPLETED') return completedApproval(current)
    throw new ApiError(409, 'This count is already being approved; try again shortly.')
  }

  const correlationId = randomUUID()
  let adjustmentsPosted = 0
  let skipped = 0
  /** Lines an earlier attempt already posted (ticket 49): not adjusted again. */
  let alreadyPosted = 0
  const errors: string[] = []
  let completed = false

  try {
    // Approvals before ticket 49 posted without idempotency keys, so a retry cannot tell which of their stock
    // changes landed. Any such posting stops the approval until it is reviewed
    // (scripts/cycle-count-legacy-postings-report.ts); nothing is matched to lines or reposted automatically.
    if ((await countLegacyCycleCountPostings(tenantId, row.id)) > 0) {
      throw new ApiError(409, 'This cycle count contains historical inventory postings that require review before approval.')
    }

    // Read again under the claim: an approval that held it before may have posted lines since the read above.
    const lines = await wmsDb.cycleCountLine.findMany({ where: { countId: row.id }, orderBy: { id: 'asc' } })
    for (const line of lines) {
      const countedQty = line.countedQty!
      if (!cycleCountLineNeedsAdjustment(line.systemQty, countedQty)) {
        skipped++
        continue
      }
      if (line.postedLedgerId) {
        alreadyPosted++
        continue
      }

      // Never post for a count another request has taken over.
      if (!(await renewApprovalClaim(tenantId, row.id, token))) throw claimLost()

      const quantityDelta = computeCycleCountDelta(line.systemQty, countedQty)
      let posted: Awaited<ReturnType<typeof inv.postStockAdjustment>>
      try {
        posted = await inv.postStockAdjustment(
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
            ledger: true,
            reason: `Cycle count ${row.id}`,
            idempotencyKey: cycleCountLineKey(line.id),
          },
          performedBy,
        )
      } catch (e) {
        errors.push(`${line.skuId.slice(-8)}: ${e instanceof Error ? e.message : 'adjustment failed'}`)
        continue
      }

      // Inventory and WMS are separate databases, so this can be lost after the stock changed. The key above
      // makes the next attempt (or the request that took the count over) find that posting and record it here
      // instead of adjusting stock again.
      let recorded: boolean
      try {
        recorded = await recordLinePosted(tenantId, row.id, line.id, token, posted.ledgerEntryId)
      } catch (e) {
        errors.push(`${line.skuId.slice(-8)}: ${e instanceof Error ? e.message : 'could not record the posting'}`)
        continue
      }
      if (!recorded) throw claimLost()
      if (posted.replayed) alreadyPosted++
      else adjustmentsPosted++
    }

    if (errors.length > 0) {
      throw new ApiError(400, `Could not post all adjustments: ${errors.join('; ')}`)
    }

    // Completed only once every line that changes stock has its posting recorded.
    const after = await wmsDb.cycleCountLine.findMany({
      where: { countId: row.id },
      select: { systemQty: true, countedQty: true, postedLedgerId: true },
    })
    const unposted = after.filter((l) => cycleCountLineNeedsAdjustment(l.systemQty, l.countedQty) && !l.postedLedgerId)
    if (unposted.length > 0) {
      throw new ApiError(409, `${unposted.length} adjustment(s) are not recorded as posted yet; approve again to finish`)
    }

    const done = await wmsDb.cycleCount.updateMany({
      where: { id: row.id, tenantId, status: 'PENDING_APPROVAL', approvalClaimId: token },
      data: { status: 'COMPLETED', approvalClaimId: null, approvalClaimExpiresAt: null },
    })
    if (done.count !== 1) throw claimLost()
    completed = true
  } finally {
    // Gives the count back for a retry, unless another request holds it now.
    if (!completed) {
      await wmsDb.cycleCount
        .updateMany({ where: { id: row.id, tenantId, approvalClaimId: token }, data: { approvalClaimId: null, approvalClaimExpiresAt: null } })
        .catch(swallowed('wms.cycleCount.releaseApprovalClaim'))
    }
  }

  const count = await wmsDb.cycleCount.findFirstOrThrow({ where: { id: row.id, tenantId }, include: { lines: true } })
  return { count, adjustmentsPosted, skipped, alreadyPosted, errors }
}
