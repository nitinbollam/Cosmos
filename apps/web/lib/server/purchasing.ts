import { Prisma, PurchaseOrderStatus } from '@/generated/prisma-purchasing'
import { purchasingDb } from './db'
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

export async function createPurchaseOrder(tenantId: string, dto: CreatePurchaseOrderInput) {
  const supplier = await purchasingDb.supplier.findFirst({ where: { id: dto.supplierId, tenantId } })
  if (!supplier) throw new ApiError(400, 'Unknown supplier for tenant')

  const lineNos = new Set(dto.lines.map((l) => l.lineNo))
  if (lineNos.size !== dto.lines.length) throw new ApiError(400, 'Duplicate line numbers')

  return purchasingDb.purchaseOrder.create({
    data: {
      tenantId,
      supplierId: dto.supplierId,
      number: dto.number,
      notes: dto.notes,
      freightAmount: new Prisma.Decimal(dto.freightAmount ?? 0),
      dutyAmount: new Prisma.Decimal(dto.dutyAmount ?? 0),
      otherLandedAmount: new Prisma.Decimal(dto.otherLandedAmount ?? 0),
      landedCostNotes: dto.landedCostNotes ?? null,
      status: PurchaseOrderStatus.DRAFT,
      lines: {
        create: dto.lines.map((l) => ({
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

