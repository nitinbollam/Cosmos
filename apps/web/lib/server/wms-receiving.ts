import { ReceivingStatus } from '@/generated/prisma-wms'
import { wmsDb } from './db'
import * as inv from './inventory'
import * as poReceiving from './po-receiving'
import { ApiError } from './session'

export async function listReceivingSessions(tenantId: string, status?: string) {
  const st = status?.trim()
  const allowed = Object.values(ReceivingStatus) as string[]
  const filter = st && allowed.includes(st) ? { status: st as ReceivingStatus } : {}
  return wmsDb.receivingSession.findMany({
    where: { tenantId, ...filter },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { _count: { select: { items: true } } },
  })
}

export async function startReceivingSession(
  tenantId: string,
  warehouseId: string,
  startedBy: string,
  poId?: string,
  asnId?: string,
) {
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

  return session
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
  return session
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
      if (line?.unitCost != null) unitCost = Number(line.unitCost)
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
    const skuReceipts = session.items
      .map((it) => ({
        skuId: it.skuId,
        quantity: Math.max(0, it.receivedQty - (it.damagedQty ?? 0)),
      }))
      .filter((r) => r.quantity > 0)
    await poReceiving.syncPurchaseOrderFromSkuReceipts(tenantId, session.poId, skuReceipts)
  }

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
    }).catch(() => undefined)
  }

  await wmsDb.receivingSession.update({
    where: { id: sessionId },
    data: {
      status: nextStatus,
      completedAt: new Date(),
      discrepancyNotes: notes?.trim() || null,
    },
  })

  return { sessionId, status: nextStatus, hasDiscrepancy }
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
