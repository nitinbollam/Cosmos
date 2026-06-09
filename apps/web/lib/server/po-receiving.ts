import { PurchaseOrderStatus, Prisma } from '@/generated/prisma-purchasing'
import { purchasingDb } from './db'
import * as inv from './inventory'
import { ApiError } from './session'

function toNumberDecimal(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  return Number((v as { toString(): string }).toString?.() ?? v)
}

export type PoLineReceipt = { lineId: string; qtyReceived: number }

export async function getPurchaseOrderForReceiving(tenantId: string, poId: string) {
  const po = await purchasingDb.purchaseOrder.findFirst({
    where: { id: poId, tenantId },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
  if (!po) throw new ApiError(404, 'Purchase order not found')
  return po
}

export function assertPoOpenForReceiving(status: PurchaseOrderStatus) {
  if (status === PurchaseOrderStatus.CANCELLED || status === PurchaseOrderStatus.CLOSED) {
    throw new ApiError(400, 'PO is not open for receiving')
  }
  if (status === PurchaseOrderStatus.DRAFT) {
    throw new ApiError(400, 'Submit the PO before receiving')
  }
}

export async function validateAndApplyPoLineReceipts(
  tenantId: string,
  poId: string,
  receipts: PoLineReceipt[],
) {
  const po = await getPurchaseOrderForReceiving(tenantId, poId)
  assertPoOpenForReceiving(po.status)

  const lineById = new Map(po.lines.map((l) => [l.id, l]))
  for (const r of receipts) {
    const line = lineById.get(r.lineId)
    if (!line) throw new ApiError(400, `Unknown line ${r.lineId}`)
    if (r.qtyReceived < 0) throw new ApiError(400, 'qtyReceived must be non-negative')
    const next = line.qtyReceived + r.qtyReceived
    if (next > line.qtyOrdered) {
      throw new ApiError(400, `Line ${line.lineNo} would exceed ordered quantity`)
    }
  }

  if (receipts.length > 0) {
    await purchasingDb.$transaction(
      receipts.map((r) =>
        purchasingDb.purchaseOrderLine.update({
          where: { id: r.lineId },
          data: { qtyReceived: { increment: r.qtyReceived } },
        }),
      ),
    )
  }

  return refreshPurchaseOrderStatus(tenantId, poId)
}

export async function refreshPurchaseOrderStatus(tenantId: string, poId: string) {
  const updated = await getPurchaseOrderForReceiving(tenantId, poId)
  const allFullyReceived = updated.lines.every((l) => l.qtyReceived >= l.qtyOrdered)
  const anyReceived = updated.lines.some((l) => l.qtyReceived > 0)

  let nextStatus: PurchaseOrderStatus = updated.status
  if (allFullyReceived) nextStatus = PurchaseOrderStatus.CLOSED
  else if (anyReceived) nextStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED
  else if (updated.status === PurchaseOrderStatus.DRAFT) nextStatus = PurchaseOrderStatus.DRAFT
  else nextStatus = PurchaseOrderStatus.SUBMITTED

  if (nextStatus === updated.status) return updated

  return purchasingDb.purchaseOrder.update({
    where: { id: poId },
    data: { status: nextStatus },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
}

export async function postInventoryForPoReceipts(
  tenantId: string,
  po: Awaited<ReturnType<typeof getPurchaseOrderForReceiving>>,
  warehouseId: string,
  receipts: PoLineReceipt[],
  performedBy: string,
) {
  const lineById = new Map(po.lines.map((l) => [l.id, l]))
  const inventoryErrors: string[] = []

  for (const r of receipts) {
    if (r.qtyReceived <= 0) continue
    const line = lineById.get(r.lineId)
    if (!line) continue
    const code = line.skuCode?.trim()
    if (!code) {
      inventoryErrors.push(`Line ${line.lineNo}: no SKU code — PO updated only`)
      continue
    }
    try {
      const sku = await inv.findSkuByCode(tenantId, code)
      const baseCost = line.unitCost != null ? toNumberDecimal(line.unitCost) : 0
      const { computeReceivedUnitCost } = await import('./landed-cost')
      const unitCost = computeReceivedUnitCost(baseCost, po, line.id, r.qtyReceived)
      await inv.receiveStock(
        tenantId,
        {
          skuId: sku.id,
          warehouseId,
          quantity: r.qtyReceived,
          unitCost,
          supplierId: po.supplierId,
          poId: po.id,
        },
        performedBy,
      )
    } catch (e) {
      inventoryErrors.push(`${code}: ${e instanceof Error ? e.message : 'inventory post failed'}`)
    }
  }

  return { inventoryErrors }
}

/** Map received SKU quantities to PO lines (by sku code) and increment qtyReceived. */
export async function syncPurchaseOrderFromSkuReceipts(
  tenantId: string,
  poId: string,
  skuReceipts: Array<{ skuId: string; quantity: number }>,
) {
  if (skuReceipts.length === 0) return null

  const po = await getPurchaseOrderForReceiving(tenantId, poId)
  assertPoOpenForReceiving(po.status)

  const byLineId = new Map<string, number>()
  for (const row of skuReceipts) {
    if (row.quantity <= 0) continue
    const sku = await inv.findSkuById(tenantId, row.skuId)
    const line = po.lines.find((l) => l.skuCode?.trim() === sku.code)
    if (!line) {
      throw new ApiError(400, `No PO line for SKU ${sku.code}`)
    }
    const open = line.qtyOrdered - line.qtyReceived - (byLineId.get(line.id) ?? 0)
    if (row.quantity > open) {
      throw new ApiError(
        400,
        `Receiving ${row.quantity} for ${sku.code} exceeds open PO quantity (${open})`,
      )
    }
    byLineId.set(line.id, (byLineId.get(line.id) ?? 0) + row.quantity)
  }

  const receipts: PoLineReceipt[] = [...byLineId.entries()].map(([lineId, qtyReceived]) => ({
    lineId,
    qtyReceived,
  }))
  if (receipts.length === 0) return po
  return validateAndApplyPoLineReceipts(tenantId, poId, receipts)
}

export async function openPoLinesForReceiving(tenantId: string, poId: string) {
  const po = await getPurchaseOrderForReceiving(tenantId, poId)
  assertPoOpenForReceiving(po.status)

  const rows: Array<{
    lineId: string
    skuId: string
    skuCode: string
    description: string
    expectedQty: number
    unitCost: number
  }> = []

  for (const line of po.lines) {
    const code = line.skuCode?.trim()
    if (!code) continue
    const open = line.qtyOrdered - line.qtyReceived
    if (open <= 0) continue
    try {
      const sku = await inv.findSkuByCode(tenantId, code)
      rows.push({
        lineId: line.id,
        skuId: sku.id,
        skuCode: code,
        description: line.description,
        expectedQty: open,
        unitCost: line.unitCost != null ? toNumberDecimal(line.unitCost) : 0,
      })
    } catch {
      // PO line references unknown SKU — skip preload
    }
  }

  return { po, rows }
}

export type ReceiveGoodsResult = {
  purchaseOrder: Awaited<ReturnType<typeof validateAndApplyPoLineReceipts>>
  inventoryErrors: string[]
}

export async function receivePurchaseOrderGoods(
  tenantId: string,
  poId: string,
  dto: { warehouseId?: string; lines: PoLineReceipt[] },
  performedBy: string,
): Promise<ReceiveGoodsResult> {
  const po = await getPurchaseOrderForReceiving(tenantId, poId)
  assertPoOpenForReceiving(po.status)

  const needsInventory = dto.lines.some((r) => {
    if (r.qtyReceived <= 0) return false
    const line = po.lines.find((l) => l.id === r.lineId)
    return Boolean(line?.skuCode?.trim())
  })
  const warehouseId = dto.warehouseId?.trim()
  if (needsInventory && !warehouseId) {
    throw new ApiError(400, 'warehouseId is required to post inventory for SKU lines')
  }

  const updatedPo = await validateAndApplyPoLineReceipts(tenantId, poId, dto.lines)
  const { inventoryErrors } = warehouseId
    ? await postInventoryForPoReceipts(tenantId, po, warehouseId, dto.lines, performedBy)
    : { inventoryErrors: [] as string[] }

  if (dto.lines.some((l) => l.qtyReceived > 0)) {
    const { createBillFromPurchaseOrder } = await import('./ap-bills')
    await createBillFromPurchaseOrder(tenantId, { purchaseOrderId: poId }).catch(() => undefined)
  }

  return { purchaseOrder: updatedPo, inventoryErrors }
}

export async function recordPoPayment(
  tenantId: string,
  poId: string,
  body: { amount: number; method: string; reference?: string },
) {
  const po = await getPurchaseOrderForReceiving(tenantId, poId)
  if (po.status === PurchaseOrderStatus.CANCELLED) {
    throw new ApiError(400, 'Cannot pay a cancelled PO')
  }

  const total = po.lines.reduce((s, l) => {
    const c = l.unitCost != null ? toNumberDecimal(l.unitCost) : 0
    return s + l.qtyOrdered * c
  }, 0)
  const paid = toNumberDecimal(po.amountPaid)
  const remaining = Math.max(0, total - paid)
  const apply = Math.min(body.amount, remaining)
  if (apply <= 0) throw new ApiError(400, 'Nothing to pay or invalid amount')

  void body.method
  void body.reference

  const updated = await purchasingDb.purchaseOrder.update({
    where: { id: poId },
    data: { amountPaid: new Prisma.Decimal(paid + apply) },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })

  const bill = await purchasingDb.vendorBill.findFirst({
    where: { tenantId, purchaseOrderId: poId, status: { not: 'VOID' } },
  })
  if (bill) {
    const { recordBillPayment } = await import('./ap-bills')
    await recordBillPayment(tenantId, bill.id, body).catch(() => undefined)
  } else {
    const { postApPaymentJournal } = await import('./operations-gl')
    await postApPaymentJournal(tenantId, poId, apply).catch(() => undefined)
  }

  return updated
}
