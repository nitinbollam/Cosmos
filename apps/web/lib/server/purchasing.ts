import { Prisma, PurchaseOrderStatus } from '@/generated/prisma-purchasing'
import { purchasingDb } from './db'
import { ApiError } from './session'
import * as poReceiving from './po-receiving'

// NOTE: This module mirrors the legacy Nest purchasing-service behavior
// for the subset used by the Next admin UI.

export type CreatePurchaseOrderInput = {
  supplierId: string
  number: string
  notes?: string
  lines: Array<{ lineNo: number; skuCode?: string; description: string; qtyOrdered: number }>
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
      status: PurchaseOrderStatus.DRAFT,
      lines: {
        create: dto.lines.map((l) => ({
          lineNo: l.lineNo,
          skuCode: l.skuCode,
          description: l.description,
          qtyOrdered: l.qtyOrdered,
        })),
      },
    },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
}

export async function submitPurchaseOrder(tenantId: string, id: string) {
  const po = await getPurchaseOrder(tenantId, id)
  if (po.status !== PurchaseOrderStatus.DRAFT) {
    throw new ApiError(400, 'Only DRAFT orders can be submitted')
  }
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

