import { Prisma, PurchaseOrderStatus, VendorBillStatus } from '@/generated/prisma-purchasing'
import { inventoryDb, purchasingDb } from './db'
import { ApiError } from './session'
import * as poReceiving from './po-receiving'
import { createApprovalRequest, findPendingApprovalForSubject } from './approvals'
import { ApprovalType } from '@/generated/prisma-tenant'
import { getTenantWorkflowSettings } from './tenant-workflow-settings'

// NOTE: This module mirrors the legacy Nest purchasing-service behavior
// for the subset used by the Next admin UI.

export type CreatePurchaseOrderInput = {
  supplierId: string
  number: string
  notes?: string
  freightAmount?: number
  dutyAmount?: number
  otherLandedAmount?: number
  landedCostNotes?: string
  lines: Array<{ lineNo: number; skuCode?: string; description: string; qtyOrdered: number; unitCost?: number }>
}

export type ReceiveGoodsInput = {
  warehouseId?: string
  lines: Array<{ lineId: string; qtyReceived: number }>
}

export type RecordPoPaymentInput = { amount: number; method: string; reference?: string }

export function listPurchaseOrders(tenantId: string, status?: string) {
  const st = (status ? (status as PurchaseOrderStatus) : undefined) ?? undefined
  return purchasingDb.purchaseOrder.findMany({
    where: { tenantId, ...(st ? { status: st } : {}) },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getPurchaseOrder(tenantId: string, id: string) {
  const row = await purchasingDb.purchaseOrder.findFirst({
    where: { id, tenantId },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
  if (!row) throw new ApiError(404, 'Purchase order not found')
  return row
}

/** A PO plus its current supplier bill, so the PO page can show it (or offer to create it). */
export async function getPurchaseOrderDetail(tenantId: string, id: string) {
  const po = await getPurchaseOrder(tenantId, id)
  const bill = await purchasingDb.vendorBill.findFirst({
    where: { tenantId, purchaseOrderId: id, status: { not: VendorBillStatus.VOID } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, billNumber: true, totalAmount: true, status: true },
  })
  return { ...po, supplierBill: bill ? { ...bill, totalAmount: Number(bill.totalAmount) } : null }
}

/** Largest quantity a single PO line may carry; far above any real wholesale order. */
export const MAX_PO_LINE_QUANTITY = 1_000_000

/** Largest unit cost or order-level charge; keeps absurd values from overflowing the database. */
export const MAX_PO_AMOUNT = 1_000_000_000

/** One problem with a purchase order, tied to the line and field it belongs to (line is null for the order as a whole). */
export type PoProblem = {
  line: number | null
  field: 'lines' | 'lineNo' | 'skuCode' | 'description' | 'qtyOrdered' | 'unitCost' | 'freightAmount' | 'dutyAmount' | 'otherLandedAmount' | 'landedCostNotes'
  message: string
}

/** One 400 for every problem found: the message lists them all, `errors` gives line and field for each. */
export function poValidationError(problems: PoProblem[]): ApiError {
  return new ApiError(400, problems.map((p) => p.message).join('; '), undefined, { errors: problems })
}

/**
 * Every PO line needs a SKU code and a whole quantity of at least 1. A line without a SKU is never
 * put into stock when it's received ("PO updated only"), so it can't be left blank. The same SKU
 * twice is refused too: scan receiving books a SKU against its first line only. Unit cost is 0 or
 * more (never negative) and bounded. All problems are collected, not just the first.
 */
export function purchaseOrderLineProblems(lines: unknown): PoProblem[] {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [{ line: null, field: 'lines', message: 'A purchase order needs at least one line' }]
  }
  const problems: PoProblem[] = []
  const lineNos = new Set<number>()
  const lineBySku = new Map<string, number>()
  for (const [i, raw] of lines.entries()) {
    const l = raw as Partial<CreatePurchaseOrderInput['lines'][number]> | null
    if (!l || !Number.isInteger(l.lineNo) || (l.lineNo as number) < 1) {
      problems.push({ line: i + 1, field: 'lineNo', message: `Line ${i + 1}: line number must be a whole number of 1 or more` })
      continue
    }
    const lineNo = l.lineNo as number
    const where = `Line ${lineNo}`
    if (lineNos.has(lineNo)) problems.push({ line: lineNo, field: 'lineNo', message: `${where}: duplicate line number` })
    lineNos.add(lineNo)
    const code = typeof l.skuCode === 'string' ? l.skuCode.trim() : ''
    if (!code) {
      problems.push({ line: lineNo, field: 'skuCode', message: `${where}: SKU code is required` })
    } else {
      const earlier = lineBySku.get(code)
      if (earlier != null) {
        problems.push({
          line: lineNo,
          field: 'skuCode',
          message: `${where}: SKU ${code} is already on line ${earlier}; change the quantity there instead`,
        })
      } else {
        lineBySku.set(code, lineNo)
      }
    }
    if (!Number.isInteger(l.qtyOrdered) || (l.qtyOrdered as number) < 1 || (l.qtyOrdered as number) > MAX_PO_LINE_QUANTITY) {
      problems.push({ line: lineNo, field: 'qtyOrdered', message: `${where}: quantity must be a whole number from 1 to ${MAX_PO_LINE_QUANTITY}` })
    }
    if (l.description != null && typeof l.description !== 'string') {
      problems.push({ line: lineNo, field: 'description', message: `${where}: description must be text` })
    }
    if (l.unitCost != null) {
      if (typeof l.unitCost !== 'number' || !Number.isFinite(l.unitCost) || l.unitCost < 0) {
        problems.push({ line: lineNo, field: 'unitCost', message: `${where}: unit cost must be a number of 0 or more` })
      } else if (l.unitCost > MAX_PO_AMOUNT) {
        problems.push({ line: lineNo, field: 'unitCost', message: `${where}: unit cost must be ${MAX_PO_AMOUNT} or less` })
      }
    }
  }
  return problems
}

export function assertValidPurchaseOrderLines(lines: unknown): asserts lines is CreatePurchaseOrderInput['lines'] {
  const problems = purchaseOrderLineProblems(lines)
  if (problems.length > 0) throw poValidationError(problems)
}

const LANDED_AMOUNT_LABELS = {
  freightAmount: 'Freight amount',
  dutyAmount: 'Duty amount',
  otherLandedAmount: 'Other landed amount',
} as const

/** Freight, duty and other landed charges: each 0 or more (never negative), a real number, bounded; notes must be text. */
export function landedCostProblems(input: {
  freightAmount?: unknown
  dutyAmount?: unknown
  otherLandedAmount?: unknown
  landedCostNotes?: unknown
}): PoProblem[] {
  const problems: PoProblem[] = []
  for (const field of ['freightAmount', 'dutyAmount', 'otherLandedAmount'] as const) {
    const v = input[field]
    if (v == null) continue
    const name = LANDED_AMOUNT_LABELS[field]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      problems.push({ line: null, field, message: `${name} must be a number of 0 or more` })
    } else if (v > MAX_PO_AMOUNT) {
      problems.push({ line: null, field, message: `${name} must be ${MAX_PO_AMOUNT} or less` })
    }
  }
  if (input.landedCostNotes != null && typeof input.landedCostNotes !== 'string') {
    problems.push({ line: null, field: 'landedCostNotes', message: 'Landed cost notes must be text' })
  }
  return problems
}

export async function createPurchaseOrder(tenantId: string, dto: CreatePurchaseOrderInput) {
  if (!dto || typeof dto !== 'object') throw new ApiError(400, 'A purchase order is required')
  const number = typeof dto.number === 'string' ? dto.number.trim() : ''
  if (!number) throw new ApiError(400, 'PO number is required')
  if (typeof dto.supplierId !== 'string' || !dto.supplierId) throw new ApiError(400, 'Supplier is required')
  const problems = [...purchaseOrderLineProblems(dto.lines), ...landedCostProblems(dto)]
  if (problems.length > 0) throw poValidationError(problems)
  assertValidPurchaseOrderLines(dto.lines)

  const supplier = await purchasingDb.supplier.findFirst({ where: { id: dto.supplierId, tenantId } })
  if (!supplier) throw new ApiError(400, 'Unknown supplier for tenant')

  // Each line must name a real, active SKU. Receiving looks the SKU up by this exact code; a blank
  // description falls back to the SKU's name.
  const skus = await inventoryDb.sKU.findMany({
    where: { tenantId, code: { in: dto.lines.map((l) => l.skuCode!.trim()) } },
    select: { code: true, name: true, isActive: true },
  })
  const skuByCode = new Map(skus.map((s) => [s.code, s]))
  const skuProblems: PoProblem[] = []
  const lines = dto.lines.map((l) => {
    const code = l.skuCode!.trim()
    const sku = skuByCode.get(code)
    if (!sku) skuProblems.push({ line: l.lineNo, field: 'skuCode', message: `Line ${l.lineNo}: SKU ${code} doesn't exist` })
    else if (!sku.isActive) skuProblems.push({ line: l.lineNo, field: 'skuCode', message: `Line ${l.lineNo}: SKU ${code} is inactive` })
    return { ...l, skuCode: code, description: l.description?.trim() || sku?.name || '' }
  })
  if (skuProblems.length > 0) throw poValidationError(skuProblems)

  if (await purchasingDb.purchaseOrder.findFirst({ where: { tenantId, number }, select: { id: true } })) {
    throw new ApiError(409, `PO number ${number} is already used`)
  }

  const po = await purchasingDb.purchaseOrder.create({
    data: {
      tenantId,
      supplierId: dto.supplierId,
      number,
      notes: dto.notes,
      freightAmount: new Prisma.Decimal(dto.freightAmount ?? 0),
      dutyAmount: new Prisma.Decimal(dto.dutyAmount ?? 0),
      otherLandedAmount: new Prisma.Decimal(dto.otherLandedAmount ?? 0),
      landedCostNotes: dto.landedCostNotes ?? null,
      status: PurchaseOrderStatus.DRAFT,
      lines: {
        create: lines.map((l) => ({
          lineNo: l.lineNo,
          skuCode: l.skuCode,
          description: l.description,
          qtyOrdered: l.qtyOrdered,
          ...(l.unitCost != null ? { unitCost: new Prisma.Decimal(l.unitCost) } : {}),
        })),
      },
    },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
  const { emitDomainEvent } = await import('./domain-events')
  void emitDomainEvent(
    tenantId,
    'purchasing.po_created',
    {
      purchaseOrderId: po.id,
      number: po.number,
      supplierId: po.supplierId,
      supplierName: po.supplier.name,
      status: po.status,
      lines: po.lines.map((l) => ({ lineNo: l.lineNo, skuCode: l.skuCode, qtyOrdered: l.qtyOrdered })),
    },
    { key: po.id },
  )
  return po
}

export function computePurchaseOrderTotal(po: {
  lines: Array<{ qtyOrdered: number; unitCost: Prisma.Decimal | null }>
  freightAmount: Prisma.Decimal | null
  dutyAmount: Prisma.Decimal | null
  otherLandedAmount: Prisma.Decimal | null
}): number {
  const linesTotal = po.lines.reduce(
    (s, l) => s + l.qtyOrdered * (l.unitCost != null ? Number(l.unitCost) : 0),
    0,
  )
  const landed =
    (po.freightAmount != null ? Number(po.freightAmount) : 0) +
    (po.dutyAmount != null ? Number(po.dutyAmount) : 0) +
    (po.otherLandedAmount != null ? Number(po.otherLandedAmount) : 0)
  return +(linesTotal + landed).toFixed(2)
}

export async function submitPurchaseOrder(tenantId: string, id: string, requestedBy?: string) {
  const po = await getPurchaseOrder(tenantId, id)
  if (po.status !== PurchaseOrderStatus.DRAFT) {
    throw new ApiError(400, 'Only DRAFT orders can be submitted')
  }

  const total = computePurchaseOrderTotal(po)
  const { poApprovalThreshold } = await getTenantWorkflowSettings(tenantId)

  if (total > poApprovalThreshold + 0.001) {
    const existing = await findPendingApprovalForSubject(tenantId, ApprovalType.PURCHASE_ORDER, id)
    if (!existing) {
      await createApprovalRequest(tenantId, {
        type: ApprovalType.PURCHASE_ORDER,
        subjectId: id,
        requestedBy: requestedBy ?? 'system',
        context: {
          number: po.number,
          total,
          threshold: poApprovalThreshold,
          supplierId: po.supplierId,
          supplierName: po.supplier?.name ?? null,
        },
      })
    }
    return purchasingDb.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.PENDING_APPROVAL },
      include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
    })
  }

  return purchasingDb.purchaseOrder.update({
    where: { id },
    data: { status: PurchaseOrderStatus.SUBMITTED },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
}

export async function submitPurchaseOrderAfterApproval(tenantId: string, id: string) {
  const po = await getPurchaseOrder(tenantId, id)
  if (po.status !== PurchaseOrderStatus.PENDING_APPROVAL) return po
  return purchasingDb.purchaseOrder.update({
    where: { id },
    data: { status: PurchaseOrderStatus.SUBMITTED },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
}

export async function cancelPurchaseOrder(tenantId: string, id: string) {
  const po = await getPurchaseOrder(tenantId, id)
  if (po.status === PurchaseOrderStatus.CLOSED || po.status === PurchaseOrderStatus.CANCELLED) {
    throw new ApiError(400, 'PO already terminal')
  }
  if (po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED) {
    throw new ApiError(400, 'Cannot cancel a partially received PO')
  }
  return purchasingDb.purchaseOrder.update({
    where: { id },
    data: { status: PurchaseOrderStatus.CANCELLED },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
}

export async function receiveGoods(
  tenantId: string,
  id: string,
  dto: ReceiveGoodsInput,
  performedBy: string,
) {
  const result = await poReceiving.receivePurchaseOrderGoods(tenantId, id, dto, performedBy)
  return {
    ...result.purchaseOrder,
    inventoryErrors: result.inventoryErrors,
    bill: result.bill,
    billError: result.billError,
  }
}

export async function updatePurchaseOrderLandedCosts(
  tenantId: string,
  id: string,
  patch: {
    freightAmount?: number
    dutyAmount?: number
    otherLandedAmount?: number
    landedCostNotes?: string | null
  },
) {
  const po = await getPurchaseOrder(tenantId, id)
  if (po.status === PurchaseOrderStatus.CANCELLED || po.status === PurchaseOrderStatus.CLOSED) {
    throw new ApiError(400, 'Cannot update landed costs on a closed/cancelled PO')
  }
  const problems = landedCostProblems(patch ?? {})
  if (problems.length > 0) throw poValidationError(problems)
  return purchasingDb.purchaseOrder.update({
    where: { id },
    data: {
      ...(patch.freightAmount !== undefined ? { freightAmount: new Prisma.Decimal(patch.freightAmount) } : {}),
      ...(patch.dutyAmount !== undefined ? { dutyAmount: new Prisma.Decimal(patch.dutyAmount) } : {}),
      ...(patch.otherLandedAmount !== undefined
        ? { otherLandedAmount: new Prisma.Decimal(patch.otherLandedAmount) }
        : {}),
      ...(patch.landedCostNotes !== undefined ? { landedCostNotes: patch.landedCostNotes } : {}),
    },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
}

export async function getPurchaseOrderLandedCostPreview(tenantId: string, id: string) {
  const po = await getPurchaseOrder(tenantId, id)
  const { totalLandedCharges, allocateLandedCostPerUnit } = await import('./landed-cost')
  const total = totalLandedCharges(po)
  const lines = po.lines.map((line) => {
    const qty = Math.max(line.qtyOrdered - line.qtyReceived, 1)
    const base = line.unitCost != null ? Number(line.unitCost) : 0
    const { landedAdderPerUnit, lineLandedTotal } = allocateLandedCostPerUnit(po, line.id, qty)
    return {
      lineId: line.id,
      lineNo: line.lineNo,
      skuCode: line.skuCode,
      baseUnitCost: base,
      landedAdderPerUnit: Math.round(landedAdderPerUnit * 10000) / 10000,
      landedUnitCost: Math.round((base + landedAdderPerUnit) * 10000) / 10000,
      lineLandedTotal: Math.round(lineLandedTotal * 100) / 100,
    }
  })
  return { purchaseOrderId: id, totalLandedCharges: total, lines }
}

export async function recordPurchaseOrderPayment(
  tenantId: string,
  id: string,
  body: RecordPoPaymentInput,
) {
  return poReceiving.recordPoPayment(tenantId, id, body)
}

export function listSuppliers(tenantId: string) {
  return purchasingDb.supplier.findMany({ where: { tenantId }, orderBy: { code: 'asc' } })
}

export async function getSupplier(tenantId: string, id: string) {
  const row = await purchasingDb.supplier.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Supplier not found')
  return row
}

export async function createSupplier(
  tenantId: string,
  dto: { code: string; name: string; email?: string; phone?: string },
) {
  return purchasingDb.supplier.create({
    data: {
      tenantId,
      code: dto.code,
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
    },
  })
}

export async function updateSupplier(
  tenantId: string,
  id: string,
  dto: { name?: string; email?: string; phone?: string | null },
) {
  await getSupplier(tenantId, id)
  return purchasingDb.supplier.update({
    where: { id },
    data: {
      name: dto.name,
      email: dto.email,
      phone: dto.phone ?? undefined,
    },
  })
}

