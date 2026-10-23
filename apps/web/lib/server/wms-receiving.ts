import { ReceivingStatus } from '@/generated/prisma-wms'
import { wmsDb } from './db'
import * as inv from './inventory'
import * as poReceiving from './po-receiving'
import { ApiError } from './session'

import { swallowed } from './fire-and-forget'
export async function listReceivingSessions(tenantId: string, status?: string) {
  const st = status?.trim()
  const allowed = Object.values(ReceivingStatus) as string[]
  const filter = st && allowed.includes(st) ? { status: st as ReceivingStatus } : {}
  const sessions = await wmsDb.receivingSession.findMany({
    where: { tenantId, ...filter },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { _count: { select: { items: true } } },
  })
  const numbers = await poReceiving.purchaseOrderNumbers(tenantId, sessions.map((s) => s.poId ?? ''))
  return sessions.map((s) => ({ ...s, poNumber: s.poId ? (numbers.get(s.poId) ?? null) : null }))
}

export async function startReceivingSession(
  tenantId: string,
  warehouseId: string,
  startedBy: string,
  /** PO id or PO number. */
  poReference?: string,
  asnId?: string,
) {
  let poId: string | undefined
  if (poReference?.trim()) {
    const po = await poReceiving.findPurchaseOrderByReference(tenantId, poReference)
    poReceiving.assertPoOpenForReceiving(po.status)
    // One receiving session per PO at a time: continue the open one (e.g. started from the PO page).
    const open = await wmsDb.receivingSession.findFirst({
      where: { tenantId, poId: po.id, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (open) return { ...open, resumed: true, poNumber: po.number }
    poId = po.id
  }

  const session = await wmsDb.receivingSession.create({
    data: {
      tenantId,
      warehouseId,
      poId: poId ?? null,
      asnId: asnId ?? null,
      startedBy,
      status: 'OPEN',
    },
  })

  if (poId?.trim()) {
    try {
      const { rows } = await poReceiving.openPoLinesForReceiving(tenantId, poId.trim())
      if (rows.length > 0) {
        await wmsDb.receivingItem.createMany({
          data: rows.map((row) => ({
            sessionId: session.id,
            skuId: row.skuId,
            purchaseOrderLineId: row.lineId,
            barcode: row.skuCode,
            expectedQty: row.expectedQty,
            receivedQty: 0,
            damagedQty: 0,
            scannedBy: startedBy,
          })),
        })
      }
    } catch {
      // PO preload is best-effort — session still usable for ad-hoc scans
    }
  }

  return { ...session, resumed: false }
}

export async function resolveDefaultWarehouseId(tenantId: string): Promise<string> {
  const warehouses = await inv.listWarehouses(tenantId)
  if (warehouses.length === 0) throw new ApiError(400, 'No warehouse configured — create one in Settings')
  const def = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  return def.id
}

type ScanDto = {
  barcode: string
  receivedQty: number
  damagedQty?: number
  batchId?: string
  expiryDate?: string
  locationId?: string
}

export async function scanReceivingItem(
  sessionId: string,
  tenantId: string,
  scannedBy: string,
  dto: ScanDto,
) {
  const session = await wmsDb.receivingSession.findFirst({
    where: {
      id: sessionId,
      tenantId,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
  })
  if (!session) throw new ApiError(404, 'Receiving session not found or not open')

  const sku = await inv.findSkuByScanValue(tenantId, dto.barcode)
  const batchKey = dto.batchId?.trim() || null
  const damaged = dto.damagedQty ?? 0

  let existing = await wmsDb.receivingItem.findFirst({
    where: {
      sessionId,
      skuId: sku.id,
      ...(session.poId ? { purchaseOrderLineId: { not: null } } : {}),
    },
  })
  if (!existing) {
    existing = await wmsDb.receivingItem.findFirst({
      where: {
        sessionId,
        skuId: sku.id,
        purchaseOrderLineId: null,
        batchId: batchKey,
      },
    })
  }

  if (session.poId) {
    // Refuse units the PO doesn't have open now, while the worker is still holding them.
    const po = await poReceiving.getPurchaseOrderForReceiving(tenantId, session.poId)
    const line = po.lines.find((l) => l.skuCode?.trim() === sku.code)
    const alreadyGood = existing ? existing.receivedQty - (existing.damagedQty ?? 0) : 0
    const problem = poReceiving.overReceiptProblem(po.number, sku.code, line, alreadyGood + dto.receivedQty - damaged)
    if (problem) throw new ApiError(400, problem)
  }

  const expiry = dto.expiryDate ? new Date(dto.expiryDate) : null

  let item
  if (existing) {
    item = await wmsDb.receivingItem.update({
      where: { id: existing.id },
      data: {
        receivedQty: { increment: dto.receivedQty },
        damagedQty: { increment: damaged },
      },
    })
  } else {
    item = await wmsDb.receivingItem.create({
      data: {
        sessionId,
        skuId: sku.id,
        purchaseOrderLineId: null,
        barcode: dto.barcode.trim(),
        expectedQty: null,
        receivedQty: dto.receivedQty,
        damagedQty: damaged,
        batchId: batchKey,
        expiryDate: expiry,
        locationId: dto.locationId?.trim() || null,
        scannedBy,
      },
    })
  }

  if (session.status === 'OPEN') {
    await wmsDb.receivingSession.update({
      where: { id: sessionId },
      data: { status: 'IN_PROGRESS' },
    })
  }

  return item
}

export async function getReceivingSession(sessionId: string, tenantId: string) {
  const session = await wmsDb.receivingSession.findFirst({
    where: { id: sessionId, tenantId },
    include: { items: { orderBy: { scannedAt: 'asc' } } },
  })
  if (!session) throw new ApiError(404, 'Receiving session not found')
  const numbers = await poReceiving.purchaseOrderNumbers(tenantId, session.poId ? [session.poId] : [])
  const codes = new Map<string, string>()
  for (const skuId of new Set(session.items.map((it) => it.skuId))) {
    // Display only: a SKU that can't be found shows its id instead.
    const sku = await inv
      .findSkuById(tenantId, skuId)
      .catch(swallowed('wms-receiving.getReceivingSession', { tenantId, level: 'warn' }))
    if (sku) codes.set(skuId, sku.code)
  }
  return {
    ...session,
    poNumber: session.poId ? (numbers.get(session.poId) ?? null) : null,
    items: session.items.map((it) => ({ ...it, skuCode: codes.get(it.skuId) ?? null })),
  }
}

export async function completeReceivingSession(sessionId: string, tenantId: string, notes: string | undefined, performedBy: string) {
  const session = await wmsDb.receivingSession.findFirst({
    where: { id: sessionId, tenantId },
    include: { items: true },
  })
  if (!session) throw new ApiError(404, 'Session not found')
  if (session.status === 'COMPLETED' || session.status === 'CLOSED') {
    throw new ApiError(400, 'Session already completed')
  }
  if (!session.items.length) {
    throw new ApiError(400, 'Cannot complete session with no items scanned')
  }

  const hasDiscrepancy = session.items.some((i) => (i.damagedQty ?? 0) > 0)
  const nextStatus = hasDiscrepancy ? 'DISCREPANCY' : 'COMPLETED'

  const skuReceipts = session.items
    .map((it) => ({ skuId: it.skuId, quantity: Math.max(0, it.receivedQty - (it.damagedQty ?? 0)) }))
    .filter((r) => r.quantity > 0)
  if (session.poId && skuReceipts.length > 0) {
    // Check against the PO before any stock moves: a refused completion must not leave stock behind.
    await poReceiving.planPoReceiptsFromSkus(tenantId, session.poId, skuReceipts)
  }

  let poForCost: Awaited<ReturnType<typeof poReceiving.getPurchaseOrderForReceiving>> | null = null
  if (session.poId) {
    try {
      poForCost = await poReceiving.getPurchaseOrderForReceiving(tenantId, session.poId)
    } catch {
      poForCost = null
    }
  }

  for (const it of session.items) {
    const goodQty = it.receivedQty - (it.damagedQty ?? 0)
    if (goodQty <= 0) continue

    let unitCost = 0
    if (poForCost) {
      const line = it.purchaseOrderLineId
        ? poForCost.lines.find((l) => l.id === it.purchaseOrderLineId)
        : undefined
      if (line?.unitCost != null) {
        const { computeReceivedUnitCost } = await import('./landed-cost')
        unitCost = computeReceivedUnitCost(Number(line.unitCost), poForCost, line.id, goodQty)
      }
    }

    await inv.receiveStock(
      tenantId,
      {
        skuId: it.skuId,
        warehouseId: session.warehouseId,
        quantity: goodQty,
        unitCost,
        supplierId: poForCost?.supplierId,
        poId: session.poId ?? undefined,
        batchId: it.batchId ?? undefined,
        locationId: it.locationId ?? undefined,
      },
      performedBy,
    )
  }

  if (session.poId) {
    await poReceiving.syncPurchaseOrderFromSkuReceipts(tenantId, session.poId, skuReceipts)
  }
  // Goods received against a PO owe the supplier: bill them, as Record receipt does.
  const billing: poReceiving.ReceiptBillOutcome =
    session.poId && session.items.some((it) => it.receivedQty - (it.damagedQty ?? 0) > 0)
      ? await poReceiving.billReceivedGoods(tenantId, session.poId, performedBy)
      : { bill: null, billError: null }

  const putawayItems = session.items
    .map((it) => ({
      skuId: it.skuId,
      batchId: it.batchId,
      quantity: Math.max(0, it.receivedQty - (it.damagedQty ?? 0)),
    }))
    .filter((it) => it.quantity > 0)

  if (putawayItems.length > 0) {
    const { createPutawayTaskFromReceiving } = await import('./wms-putaway')
    await createPutawayTaskFromReceiving(tenantId, sessionId, session.warehouseId, putawayItems).catch(
      () => undefined,
    )
  }

  const { recordLaborEvent } = await import('./wms-labor')
  for (const it of session.items) {
    const qty = Math.max(0, it.receivedQty - (it.damagedQty ?? 0))
    if (qty <= 0) continue
    void recordLaborEvent(tenantId, {
      userId: performedBy,
      eventType: 'RECEIVE_SCAN',
      referenceId: it.id,
      quantity: qty,
      warehouseId: session.warehouseId,
    }).catch(swallowed('wms-receiving.completeReceivingSession'))
  }

  await wmsDb.receivingSession.update({
    where: { id: sessionId },
    data: {
      status: nextStatus,
      completedAt: new Date(),
      discrepancyNotes: notes?.trim() || null,
    },
  })

  const { emitDomainEvent } = await import('./domain-events')
  void emitDomainEvent(
    tenantId,
    'wms.receiving_completed',
    {
      receivingSessionId: sessionId,
      status: nextStatus,
      hasDiscrepancy,
      warehouseId: session.warehouseId,
      purchaseOrderId: session.poId ?? null,
      items: session.items.map((it) => ({
        skuId: it.skuId,
        receivedQty: it.receivedQty,
        damagedQty: it.damagedQty ?? 0,
      })),
    },
    { key: sessionId },
  )
  return { sessionId, status: nextStatus, hasDiscrepancy, ...billing }
}

export async function importReceivingItems(
  sessionId: string,
  tenantId: string,
  scannedBy: string,
  rows: ScanDto[],
) {
  let created = 0
  const errors: Array<{ row: number; message: string }> = []
  for (let index = 0; index < rows.length; index++) {
    try {
      await scanReceivingItem(sessionId, tenantId, scannedBy, rows[index])
      created++
    } catch (e) {
      errors.push({
        row: index + 2,
        message: e instanceof Error ? e.message : 'Import row failed',
      })
    }
  }
  return { created, failed: errors.length, errors }
}
