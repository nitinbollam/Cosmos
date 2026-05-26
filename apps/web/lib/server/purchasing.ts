import { Prisma, PurchaseOrderStatus } from '@/generated/prisma-purchasing'
import { purchasingDb } from './db'
import { ApiError } from './session'

// NOTE: This module mirrors the legacy Nest purchasing-service behavior
// for the subset used by the Next admin UI.

export type CreatePurchaseOrderInput = {
  supplierId: string
  number: string
  notes?: string
  lines: Array<{ lineNo: number; skuCode?: string; description: string; qtyOrdered: number }>
}

export type ReceiveGoodsInput = { lines: Array<{ lineId: string; qtyReceived: number }> }

export type RecordPoPaymentInput = { amount: number; method: string; reference?: string }

function toNumberDecimal(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  // Prisma.Decimal typically implements valueOf()/toString()
  return Number((v as { toString(): string }).toString?.() ?? v)
}

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

export async function receiveGoods(tenantId: string, id: string, dto: ReceiveGoodsInput) {
  const po = await getPurchaseOrder(tenantId, id)
  if (po.status === PurchaseOrderStatus.CANCELLED || po.status === PurchaseOrderStatus.CLOSED) {
    throw new ApiError(400, 'PO is not open for receiving')
  }
  if (po.status === PurchaseOrderStatus.DRAFT) {
    throw new ApiError(400, 'Submit the PO before receiving')
  }

  const lineById = new Map(po.lines.map((l) => [l.id, l]))
  for (const r of dto.lines) {
    const line = lineById.get(r.lineId)
    if (!line) throw new ApiError(400, `Unknown line ${r.lineId}`)
    if (r.qtyReceived < 0) throw new ApiError(400, 'qtyReceived must be non-negative')
    const next = line.qtyReceived + r.qtyReceived
    if (next > line.qtyOrdered) {
      throw new ApiError(400, `Line ${line.lineNo} would exceed ordered quantity`)
    }
  }

  await purchasingDb.$transaction(
    dto.lines.map((r) =>
      purchasingDb.purchaseOrderLine.update({
        where: { id: r.lineId },
        data: { qtyReceived: { increment: r.qtyReceived } },
      }),
    ),
  )

  const updated = await getPurchaseOrder(tenantId, id)
  const allFullyReceived = updated.lines.every((l) => l.qtyReceived >= l.qtyOrdered)
  const anyReceived = updated.lines.some((l) => l.qtyReceived > 0)

  let nextStatus: PurchaseOrderStatus = po.status
  if (allFullyReceived) nextStatus = PurchaseOrderStatus.CLOSED
  else if (anyReceived) nextStatus = PurchaseOrderStatus.PARTIALLY_RECEIVED
  else nextStatus = PurchaseOrderStatus.SUBMITTED

  return purchasingDb.purchaseOrder.update({
    where: { id },
    data: { status: nextStatus },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
}

function poLineTotal(lines: Array<{ qtyOrdered: number; unitCost: unknown }>): number {
  return lines.reduce((s, l) => {
    const c = l.unitCost != null ? toNumberDecimal(l.unitCost) : 0
    return s + l.qtyOrdered * c
  }, 0)
}

export async function recordPurchaseOrderPayment(
  tenantId: string,
  id: string,
  body: RecordPoPaymentInput,
) {
  const po = await getPurchaseOrder(tenantId, id)
  if (po.status === PurchaseOrderStatus.CANCELLED) {
    throw new ApiError(400, 'Cannot pay a cancelled PO')
  }

  const total = poLineTotal(po.lines.map((l) => ({ qtyOrdered: l.qtyOrdered, unitCost: l.unitCost })))
  const paid = toNumberDecimal(po.amountPaid)
  const remaining = Math.max(0, total - paid)
  const apply = Math.min(body.amount, remaining)
  if (apply <= 0) throw new ApiError(400, 'Nothing to pay or invalid amount')

  void body.method
  void body.reference

  const nextPaid = paid + apply
  return purchasingDb.purchaseOrder.update({
    where: { id },
    data: { amountPaid: new Prisma.Decimal(nextPaid) },
    include: { lines: { orderBy: { lineNo: 'asc' } }, supplier: true },
  })
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

