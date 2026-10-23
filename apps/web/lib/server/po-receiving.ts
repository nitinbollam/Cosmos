import { PurchaseOrderStatus, Prisma } from '@/generated/prisma-purchasing'
import { randomUUID } from 'node:crypto'
import { orderDb, purchasingDb } from './db'
import { enqueuePostingJob } from './posting-outbox'
import * as inv from './inventory'
import { auditLog } from './audit-log'
import { swallowed } from './fire-and-forget'
import { ApiError } from './session'

function toNumberDecimal(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  return Number((v as { toString(): string }).toString?.() ?? v)
}

export type PoLineReceipt = { lineId: string; qtyReceived: number }

/** The supplier bill after a receipt, as shown to the person who received the goods. */
export type ReceiptBillOutcome = {
  bill: { id: string; billNumber: string; totalAmount: number } | null
  /** Why the bill couldn't be created. The receipt itself is already saved. */
  billError: string | null
}

/** A reason the person receiving goods can act on; database detail stays in the audit log. */
export function billFailureReason(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return 'another supplier bill already uses this bill number'
  }
  return 'an unexpected error (details are in the audit log)'
}

type BillReceiptDeps = {
  createBill?: (
    tenantId: string,
    input: { purchaseOrderId: string },
  ) => Promise<{ id: string; billNumber: string; totalAmount: unknown }>
  audit?: typeof auditLog
}

/**
 * Create or refresh the supplier bill for a PO after goods arrive (both Record receipt and
 * scanner receiving sessions). Never throws: the goods are already received, so a failure is
 * returned for the screen to show and kept in the audit log, and "Create bill" on the PO retries.
 */
export async function billReceivedGoods(
  tenantId: string,
  poId: string,
  performedBy: string | undefined,
  deps: BillReceiptDeps = {},
): Promise<ReceiptBillOutcome> {
  try {
    const createBill = deps.createBill ?? (await import('./ap-bills')).createBillFromPurchaseOrder
    const bill = await createBill(tenantId, { purchaseOrderId: poId })
    return {
      bill: { id: bill.id, billNumber: bill.billNumber, totalAmount: toNumberDecimal(bill.totalAmount) },
      billError: null,
    }
  } catch (err) {
    const reason = billFailureReason(err)
    console.error(`[ap] vendor bill creation failed for PO ${poId}:`, err)
    await (deps.audit ?? auditLog)(tenantId, {
      action: 'ap.bill_creation_failed',
      entityType: 'PurchaseOrder',
      entityId: poId,
      userId: performedBy,
      metadata: { reason, detail: err instanceof Error ? err.message.slice(0, 1000) : String(err) },
    }).catch(swallowed('po-receiving.billReceivedGoods', { tenantId }))
    return { bill: null, billError: reason }
  }
}

/** Find a PO by its id or its number (what a warehouse worker actually sees on the paperwork). */
export async function findPurchaseOrderByReference(tenantId: string, reference: string) {
  const ref = reference.trim()
  const po = await purchasingDb.purchaseOrder.findFirst({
    where: { tenantId, OR: [{ id: ref }, { number: ref }, { number: ref.toUpperCase() }] },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
  if (!po) throw new ApiError(404, `No purchase order "${ref}"`)
  return po
}

/**
 * Why `quantity` units of a SKU can't be received against a PO line, or null when they fit.
 * `quantity` is the total for this receipt so far (earlier scans plus the new one).
 */
export function overReceiptProblem(
  poNumber: string,
  skuCode: string,
  line: { qtyOrdered: number; qtyReceived: number } | undefined,
  quantity: number,
): string | null {
  if (!line) return `${skuCode} isn't on ${poNumber}`
  const open = Math.max(0, line.qtyOrdered - line.qtyReceived)
  if (quantity <= open) return null
  if (open === 0) return `${poNumber} has no more ${skuCode} to receive`
  return `${poNumber} has only ${open} more ${skuCode} to receive, not ${quantity}`
}

/** PO numbers by id, so receiving screens can show "PO-1001" instead of an internal id. */
export async function purchaseOrderNumbers(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const rows = await purchasingDb.purchaseOrder.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, number: true },
  })
  return new Map(rows.map((r) => [r.id, r.number]))
}

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
  if (status === PurchaseOrderStatus.PENDING_APPROVAL) {
    throw new ApiError(400, 'PO is awaiting manager approval')
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

/**
 * Map received SKU quantities to PO lines (by sku code) without changing anything. Throws a
 * plain-language 400 for a SKU that isn't on the PO or more units than the PO has open, so a
 * receiving session can be refused before any stock is posted.
 */
export async function planPoReceiptsFromSkus(
  tenantId: string,
  poId: string,
  skuReceipts: Array<{ skuId: string; quantity: number }>,
) {
  const po = await getPurchaseOrderForReceiving(tenantId, poId)
  assertPoOpenForReceiving(po.status)

  const byLineId = new Map<string, number>()
  for (const row of skuReceipts) {
    if (row.quantity <= 0) continue
    const sku = await inv.findSkuById(tenantId, row.skuId)
    const line = po.lines.find((l) => l.skuCode?.trim() === sku.code)
    const total = (line ? (byLineId.get(line.id) ?? 0) : 0) + row.quantity
    const problem = overReceiptProblem(po.number, sku.code, line, total)
    if (problem || !line) throw new ApiError(400, problem ?? `${sku.code} isn't on ${po.number}`)
    byLineId.set(line.id, total)
  }

  const receipts: PoLineReceipt[] = [...byLineId.entries()].map(([lineId, qtyReceived]) => ({
    lineId,
    qtyReceived,
  }))
  return { po, receipts }
}

/** Map received SKU quantities to PO lines (by sku code) and increment qtyReceived. */
export async function syncPurchaseOrderFromSkuReceipts(
  tenantId: string,
  poId: string,
  skuReceipts: Array<{ skuId: string; quantity: number }>,
) {
  if (skuReceipts.length === 0) return null

  const { po, receipts } = await planPoReceiptsFromSkus(tenantId, poId, skuReceipts)
  if (receipts.length === 0) return po
  const updated = await validateAndApplyPoLineReceipts(tenantId, poId, receipts)
  // Scanner receiving (WMS sessions) lands here rather than in receivePurchaseOrderGoods.
  const { emitDomainEvent } = await import('./domain-events')
  void emitDomainEvent(tenantId, 'purchasing.po_received', {
    purchaseOrderId: poId,
    status: updated.status,
    warehouseId: null,
    received: receipts,
  })
  return updated
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

export type ReceiveGoodsResult = ReceiptBillOutcome & {
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

  const billing: ReceiptBillOutcome = dto.lines.some((l) => l.qtyReceived > 0)
    ? await billReceivedGoods(tenantId, poId, performedBy)
    : { bill: null, billError: null }

  // One event per receipt (no dedupe key): partial receipts against one PO are normal.
  const received = dto.lines
    .filter((l) => l.qtyReceived > 0)
    .map((l) => ({ lineId: l.lineId, qtyReceived: l.qtyReceived }))
  if (received.length > 0) {
    const { emitDomainEvent } = await import('./domain-events')
    void emitDomainEvent(tenantId, 'purchasing.po_received', {
      purchaseOrderId: poId,
      status: updatedPo.status,
      warehouseId: warehouseId ?? null,
      received,
    })
  }
  return { purchaseOrder: updatedPo, inventoryErrors, ...billing }
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

  // With a bill, the bill payment goes first and carries the AP posting, so a failure there leaves
  // the PO untouched and the request can simply be repeated. Without one the PO payment is posted
  // here, through the outbox so the posting is keyed, retried and visible when it fails.
  const bill = await purchasingDb.vendorBill.findFirst({
    where: { tenantId, purchaseOrderId: poId, status: { not: 'VOID' } },
  })
  if (bill) {
    const { recordBillPayment } = await import('./ap-bills')
    await recordBillPayment(tenantId, bill.id, body)
  }

  const updated = await purchasingDb.purchaseOrder.update({
    where: { id: poId },
    data: { amountPaid: new Prisma.Decimal(paid + apply) },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })

  if (!bill) {
    await enqueuePostingJob(orderDb, {
      tenantId,
      kind: 'AP_PAYMENT_JOURNAL',
      sourceType: 'PurchaseOrder',
      sourceId: poId,
      variant: `pay:${randomUUID()}`,
      amount: new Prisma.Decimal(apply).toFixed(2),
    })
  }

  return updated
}
