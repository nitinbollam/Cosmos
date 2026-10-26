/**
 * Fixed, SELECT-only ERP reads for Celestial. Every query is tenant-scoped, projects a fixed set of
 * fields, orders deterministically and pages at PAGE_SIZE with an all-match count. Nothing here
 * creates, syncs, notifies or audits — the shared services those reads live beside do, so Celestial
 * keeps its own projections instead of calling them.
 */
import { crmDb, inventoryDb, orderDb, purchasingDb, storefrontDb } from '../db'
import {
  OUTSTANDING_BILL_STATUSES,
  PAGE_SIZE,
  caseVariants,
  goodsCost,
  roundMoney,
  sumByCurrency,
  type BillStatusFilter,
  type DateRange,
  type OrderChannelFilter,
  type OrderPriorityFilter,
  type OrderStatusFilter,
  type PoStatusFilter,
  type QuoteStatusFilter,
  type SortDirection,
} from './erp-query-contracts'

/** Upper bound on stock rows (SKU × warehouse) and on bills read to compute currency totals. */
const STOCK_ROW_LIMIT = 24
const STOCK_SKU_LIMIT = 50
const BILL_TOTALS_CAP = 1000

export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number }

function skipFor(page?: number): { page: number; skip: number } {
  const p = page && page > 1 ? Math.floor(page) : 1
  return { page: p, skip: (p - 1) * PAGE_SIZE }
}

function num(v: unknown): number {
  return v == null ? 0 : Number(v)
}

function nullableNum(v: unknown): number | null {
  return v == null ? null : Number(v)
}

function containsAny(field: string, term: string) {
  return caseVariants(term).map((v) => ({ [field]: { contains: v } }))
}

async function customerNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const rows = await crmDb.customer.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, name: true },
  })
  return new Map(rows.map((c) => [c.id, c.name]))
}

// ── inventory.stock ─────────────────────────────────────────────────────────

export type StockRow = {
  skuId: string
  code: string
  name: string
  unit: string
  warehouseCode: string
  warehouseName: string
  onHand: number
  reserved: number
  available: number
  reorderPoint: number
}

export type StockSummary = { code: string; name: string; unit: string; available: number; onHand: number }

export async function inventoryStock(
  tenantId: string,
  q: { tokens: string[] },
): Promise<{ rows: StockRow[]; totalRows: number; skuSummaries: StockSummary[]; matchedSkus: number }> {
  const where = {
    tenantId,
    isActive: true,
    AND: q.tokens.map((t) => ({ OR: [...containsAny('name', t), ...containsAny('code', t)] })),
  }
  const [skus, matchedSkus] = await Promise.all([
    inventoryDb.sKU.findMany({
      where,
      select: { id: true, code: true, name: true, unitOfMeasure: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      take: STOCK_SKU_LIMIT,
    }),
    inventoryDb.sKU.count({ where }),
  ])
  if (skus.length === 0) return { rows: [], totalRows: 0, skuSummaries: [], matchedSkus }

  const levels = await inventoryDb.stockLevel.findMany({
    where: { tenantId, skuId: { in: skus.map((s) => s.id) } },
    select: {
      skuId: true,
      warehouseId: true,
      quantityOnHand: true,
      quantityReserved: true,
      quantityAvailable: true,
      reorderPoint: true,
    },
  })
  const warehouseIds = [...new Set(levels.map((l) => l.warehouseId))]
  const warehouses =
    warehouseIds.length > 0
      ? await inventoryDb.warehouse.findMany({
          where: { tenantId, id: { in: warehouseIds } },
          select: { id: true, code: true, name: true },
        })
      : []
  const whMap = new Map(warehouses.map((w) => [w.id, w]))
  const skuMap = new Map(skus.map((s) => [s.id, s]))

  // A SKU can hold several batch/bin rows per warehouse; fold them into one row per SKU × warehouse.
  const byKey = new Map<string, StockRow>()
  for (const l of levels) {
    const sku = skuMap.get(l.skuId)
    if (!sku) continue
    const key = `${l.skuId}:${l.warehouseId}`
    const wh = whMap.get(l.warehouseId)
    const row = byKey.get(key) ?? {
      skuId: sku.id,
      code: sku.code,
      name: sku.name,
      unit: sku.unitOfMeasure,
      warehouseCode: wh?.code ?? l.warehouseId,
      warehouseName: wh?.name ?? l.warehouseId,
      onHand: 0,
      reserved: 0,
      available: 0,
      reorderPoint: 0,
    }
    row.onHand += l.quantityOnHand
    row.reserved += l.quantityReserved
    row.available += l.quantityAvailable
    row.reorderPoint = Math.max(row.reorderPoint, l.reorderPoint)
    byKey.set(key, row)
  }

  const rows = [...byKey.values()].sort(
    (a, b) => a.code.localeCompare(b.code) || a.warehouseCode.localeCompare(b.warehouseCode),
  )

  // SKUs with no stock-level rows are reported as "no recorded stock", not as zero on hand.
  const skuSummaries: StockSummary[] = skus
    .filter((s) => rows.some((r) => r.skuId === s.id))
    .map((s) => {
      const mine = rows.filter((r) => r.skuId === s.id)
      return {
        code: s.code,
        name: s.name,
        unit: s.unitOfMeasure,
        available: mine.reduce((acc, r) => acc + r.available, 0),
        onHand: mine.reduce((acc, r) => acc + r.onHand, 0),
      }
    })

  return { rows: rows.slice(0, STOCK_ROW_LIMIT), totalRows: rows.length, skuSummaries, matchedSkus }
}

// ── search_catalog ──────────────────────────────────────────────────────────

export type CatalogRow = { id: string; code: string; name: string; unit: string; price: number; available: number | null }

/** Active SKUs whose name or code contains every token, with stock summed across warehouses. */
export async function catalogSearch(tenantId: string, tokens: string[], pageNo?: number): Promise<Page<CatalogRow>> {
  const { page, skip } = skipFor(pageNo)
  const where = {
    tenantId,
    isActive: true,
    AND: tokens.map((t) => ({ OR: [...containsAny('name', t), ...containsAny('code', t)] })),
  }
  const [skus, total] = await Promise.all([
    inventoryDb.sKU.findMany({
      where,
      select: { id: true, code: true, name: true, unitOfMeasure: true, price: true },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      skip,
      take: PAGE_SIZE,
    }),
    inventoryDb.sKU.count({ where }),
  ])
  const levels =
    skus.length > 0
      ? await inventoryDb.stockLevel.findMany({
          where: { tenantId, skuId: { in: skus.map((s) => s.id) } },
          select: { skuId: true, quantityAvailable: true },
        })
      : []
  const available = new Map<string, number>()
  for (const l of levels) available.set(l.skuId, (available.get(l.skuId) ?? 0) + l.quantityAvailable)
  return {
    rows: skus.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      unit: s.unitOfMeasure,
      price: num(s.price),
      // No stock-level rows means nothing recorded, which is not the same as zero on hand.
      available: available.has(s.id) ? available.get(s.id)! : null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  }
}

// ── orders.list / orders.detail ─────────────────────────────────────────────

export type OrderListFilters = {
  status?: OrderStatusFilter
  channel?: OrderChannelFilter
  priority?: OrderPriorityFilter
  dateRange?: DateRange
  sort?: SortDirection
  page?: number
}

export type OrderListRow = {
  id: string
  orderNumber: number | null
  status: string
  channel: string
  priority: string
  customerName: string | null
  totalAmount: number
  createdAt: Date
  lineCount: number
}

export async function ordersList(tenantId: string, f: OrderListFilters): Promise<Page<OrderListRow>> {
  const { page, skip } = skipFor(f.page)
  const where = {
    tenantId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.channel ? { channel: f.channel } : {}),
    ...(f.priority ? { priority: f.priority } : {}),
    ...(f.dateRange ? { createdAt: { gte: f.dateRange.from, lt: f.dateRange.to } } : {}),
  }
  const dir = f.sort ?? 'desc'
  const [items, total] = await Promise.all([
    orderDb.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        channel: true,
        priority: true,
        customerId: true,
        totalAmount: true,
        createdAt: true,
        _count: { select: { lineItems: true } },
      },
      orderBy: [{ createdAt: dir }, { id: dir }],
      skip,
      take: PAGE_SIZE,
    }),
    orderDb.order.count({ where }),
  ])
  const names = await customerNames(tenantId, items.map((o) => o.customerId))
  return {
    rows: items.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      channel: o.channel,
      priority: o.priority,
      customerName: names.get(o.customerId) ?? null,
      totalAmount: num(o.totalAmount),
      createdAt: o.createdAt,
      lineCount: o._count.lineItems,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  }
}

export async function ordersDetail(tenantId: string, ref: { id?: string; orderNumber?: number }) {
  if (!ref.id && ref.orderNumber == null) return null
  const order = await orderDb.order.findFirst({
    where: { tenantId, ...(ref.id ? { id: ref.id } : { orderNumber: ref.orderNumber }) },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      channel: true,
      priority: true,
      customerId: true,
      totalAmount: true,
      amountPaid: true,
      taxAmount: true,
      createdAt: true,
      confirmedAt: true,
      cancelledAt: true,
      lineItems: {
        select: { skuId: true, quantity: true, quantityAllocated: true, quantityBackordered: true, unitPrice: true },
        orderBy: { id: 'asc' },
      },
      shipments: {
        select: { shipmentNo: true, status: true, carrier: true, trackingNumber: true, shippedAt: true },
        orderBy: { shipmentNo: 'asc' },
      },
    },
  })
  if (!order) return null

  const skuIds = [...new Set(order.lineItems.map((l) => l.skuId))]
  const skus =
    skuIds.length > 0
      ? await inventoryDb.sKU.findMany({ where: { tenantId, id: { in: skuIds } }, select: { id: true, code: true, name: true } })
      : []
  const skuMap = new Map(skus.map((s) => [s.id, s]))
  const names = await customerNames(tenantId, [order.customerId])

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    channel: order.channel,
    priority: order.priority,
    customerName: names.get(order.customerId) ?? null,
    totalAmount: num(order.totalAmount),
    amountPaid: num(order.amountPaid),
    taxAmount: num(order.taxAmount),
    createdAt: order.createdAt,
    confirmedAt: order.confirmedAt,
    cancelledAt: order.cancelledAt,
    lines: order.lineItems.map((l) => ({
      skuCode: skuMap.get(l.skuId)?.code ?? null,
      skuName: skuMap.get(l.skuId)?.name ?? null,
      quantity: l.quantity,
      allocated: l.quantityAllocated,
      backordered: l.quantityBackordered,
      unitPrice: num(l.unitPrice),
    })),
    // Shipment dates come only from OrderShipment.shippedAt; Pleros records no delivery timestamp here.
    shipments: order.shipments,
  }
}

// ── purchasing.orders / purchasing.order_detail ─────────────────────────────

export type PurchaseOrderListRow = {
  id: string
  number: string
  status: string
  supplierName: string
  currency: string
  createdAt: Date
  lineCount: number
  qtyOrdered: number
  qtyReceived: number
  goodsCost: number | null
  missingCostLines: number
}

async function supplierIdsMatching(tenantId: string, supplier?: string): Promise<string[] | undefined> {
  if (!supplier?.trim()) return undefined
  const rows = await purchasingDb.supplier.findMany({
    where: { tenantId, OR: [...containsAny('name', supplier.trim()), ...containsAny('code', supplier.trim())] },
    select: { id: true },
    take: 50,
  })
  return rows.map((r) => r.id)
}

export async function purchasingOrders(
  tenantId: string,
  f: { status?: PoStatusFilter; supplier?: string; dateRange?: DateRange; page?: number },
): Promise<Page<PurchaseOrderListRow>> {
  const { page, skip } = skipFor(f.page)
  const supplierIds = await supplierIdsMatching(tenantId, f.supplier)
  if (supplierIds && supplierIds.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE }
  const where = {
    tenantId,
    ...(f.status ? { status: f.status } : {}),
    ...(supplierIds ? { supplierId: { in: supplierIds } } : {}),
    ...(f.dateRange ? { createdAt: { gte: f.dateRange.from, lt: f.dateRange.to } } : {}),
  }
  const [items, total] = await Promise.all([
    purchasingDb.purchaseOrder.findMany({
      where,
      select: {
        id: true,
        number: true,
        status: true,
        currency: true,
        createdAt: true,
        supplier: { select: { name: true } },
        lines: { select: { qtyOrdered: true, qtyReceived: true, unitCost: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: PAGE_SIZE,
    }),
    purchasingDb.purchaseOrder.count({ where }),
  ])
  return {
    rows: items.map((po) => {
      const cost = goodsCost(po.lines.map((l) => ({ qty: l.qtyOrdered, unitCost: nullableNum(l.unitCost) })))
      return {
        id: po.id,
        number: po.number,
        status: po.status,
        supplierName: po.supplier.name,
        currency: po.currency,
        createdAt: po.createdAt,
        lineCount: po.lines.length,
        qtyOrdered: po.lines.reduce((a, l) => a + l.qtyOrdered, 0),
        qtyReceived: po.lines.reduce((a, l) => a + l.qtyReceived, 0),
        goodsCost: cost.amount,
        missingCostLines: cost.missingCostLines,
      }
    }),
    total,
    page,
    pageSize: PAGE_SIZE,
  }
}

export async function purchasingOrderDetail(tenantId: string, ref: { number?: string }) {
  if (!ref.number) return null
  const po = await purchasingDb.purchaseOrder.findFirst({
    where: { tenantId, OR: caseVariants(ref.number).map((n) => ({ number: n })) },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      notes: true,
      createdAt: true,
      supplier: { select: { name: true, code: true } },
      lines: {
        select: { lineNo: true, skuCode: true, description: true, qtyOrdered: true, qtyReceived: true, unitCost: true },
        orderBy: { lineNo: 'asc' },
      },
    },
  })
  if (!po) return null
  const bills = await purchasingDb.vendorBill.findMany({
    where: { tenantId, purchaseOrderId: po.id, status: { not: 'VOID' } },
    select: { id: true, billNumber: true, status: true, totalAmount: true, amountPaid: true, currency: true, dueAt: true },
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
  })
  const lines = po.lines.map((l) => ({
    lineNo: l.lineNo,
    skuCode: l.skuCode,
    description: l.description,
    qtyOrdered: l.qtyOrdered,
    qtyReceived: l.qtyReceived,
    unitCost: nullableNum(l.unitCost),
  }))
  const cost = goodsCost(lines.map((l) => ({ qty: l.qtyOrdered, unitCost: l.unitCost })))
  return {
    id: po.id,
    number: po.number,
    status: po.status,
    currency: po.currency,
    createdAt: po.createdAt,
    supplierName: po.supplier.name,
    lines,
    goodsCost: cost.amount,
    missingCostLines: cost.missingCostLines,
    bills: bills.map((b) => ({
      billNumber: b.billNumber,
      status: b.status,
      currency: b.currency,
      totalAmount: num(b.totalAmount),
      balance: roundMoney(num(b.totalAmount) - num(b.amountPaid)),
      dueAt: b.dueAt,
    })),
  }
}

// ── finance.bills (accounts payable) ────────────────────────────────────────

export type BillFilters = {
  status?: BillStatusFilter
  /** true: still owed; false: fully settled. Undefined: no settlement filter. */
  outstanding?: boolean
  pastDue?: boolean
  supplier?: string
  dateRange?: DateRange
  page?: number
}

export type BillRow = {
  id: string
  billNumber: string
  status: string
  supplierName: string
  currency: string
  totalAmount: number
  balance: number
  issuedAt: Date
  dueAt: Date | null
  pastDue: boolean
}

export async function financeBills(
  tenantId: string,
  f: BillFilters,
  now = new Date(),
): Promise<Page<BillRow> & { balanceByCurrency: Record<string, number>; totalsTruncated: boolean }> {
  const { page, skip } = skipFor(f.page)
  const supplierIds = await supplierIdsMatching(tenantId, f.supplier)
  if (supplierIds && supplierIds.length === 0) {
    return { rows: [], total: 0, page, pageSize: PAGE_SIZE, balanceByCurrency: {}, totalsTruncated: false }
  }

  let statusFilter: { status?: BillStatusFilter | { in: BillStatusFilter[] } } = {}
  if (f.status) statusFilter = { status: f.status }
  else if (f.outstanding === true || f.pastDue) statusFilter = { status: { in: OUTSTANDING_BILL_STATUSES } }
  else if (f.outstanding === false) statusFilter = { status: 'PAID' }

  const where = {
    tenantId,
    ...statusFilter,
    ...(supplierIds ? { supplierId: { in: supplierIds } } : {}),
    ...(f.pastDue ? { dueAt: { lt: now } } : {}),
    ...(f.dateRange ? { issuedAt: { gte: f.dateRange.from, lt: f.dateRange.to } } : {}),
  }

  const [items, total, forTotals] = await Promise.all([
    purchasingDb.vendorBill.findMany({
      where,
      select: {
        id: true,
        billNumber: true,
        status: true,
        currency: true,
        totalAmount: true,
        amountPaid: true,
        issuedAt: true,
        dueAt: true,
        supplier: { select: { name: true } },
      },
      orderBy: f.pastDue || f.outstanding ? [{ dueAt: 'asc' }, { id: 'asc' }] : [{ issuedAt: 'desc' }, { id: 'desc' }],
      skip,
      take: PAGE_SIZE,
    }),
    purchasingDb.vendorBill.count({ where }),
    purchasingDb.vendorBill.findMany({
      where,
      select: { currency: true, totalAmount: true, amountPaid: true },
      take: BILL_TOTALS_CAP,
    }),
  ])

  return {
    rows: items.map((b) => {
      const balance = roundMoney(num(b.totalAmount) - num(b.amountPaid))
      return {
        id: b.id,
        billNumber: b.billNumber,
        status: b.status,
        supplierName: b.supplier.name,
        currency: b.currency,
        totalAmount: num(b.totalAmount),
        balance,
        issuedAt: b.issuedAt,
        dueAt: b.dueAt,
        pastDue: balance > 0 && b.dueAt != null && b.dueAt < now,
      }
    }),
    total,
    page,
    pageSize: PAGE_SIZE,
    balanceByCurrency: sumByCurrency(
      forTotals.map((b) => ({ currency: b.currency, amount: num(b.totalAmount) - num(b.amountPaid) })),
    ),
    totalsTruncated: total > BILL_TOTALS_CAP,
  }
}

// ── quotes.list / quotes.detail ─────────────────────────────────────────────

function quoteNumberOf(id: string): string {
  return `Q-${id.slice(-8).toUpperCase()}`
}

export type QuoteListRow = {
  id: string
  quoteNumber: string
  status: string
  customerName: string | null
  lineCount: number
  quoteTotal: number
  convertedOrderId: string | null
  createdAt: Date
}

export async function quotesList(
  tenantId: string,
  f: { status?: QuoteStatusFilter; dateRange?: DateRange; page?: number },
): Promise<Page<QuoteListRow>> {
  const { page, skip } = skipFor(f.page)
  const where = {
    tenantId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.dateRange ? { createdAt: { gte: f.dateRange.from, lt: f.dateRange.to } } : {}),
  }
  const [items, total] = await Promise.all([
    storefrontDb.b2BQuote.findMany({
      where,
      select: {
        id: true,
        status: true,
        customerRef: true,
        convertedOrderId: true,
        createdAt: true,
        lines: { select: { qty: true, unitPrice: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: PAGE_SIZE,
    }),
    storefrontDb.b2BQuote.count({ where }),
  ])
  const names = await customerNames(tenantId, items.map((q) => q.customerRef))
  return {
    rows: items.map((q) => ({
      id: q.id,
      quoteNumber: quoteNumberOf(q.id),
      status: q.status,
      customerName: names.get(q.customerRef) ?? null,
      lineCount: q.lines.length,
      quoteTotal: roundMoney(q.lines.reduce((a, l) => a + l.qty * num(l.unitPrice), 0)),
      convertedOrderId: q.convertedOrderId,
      createdAt: q.createdAt,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  }
}

export async function quotesDetail(tenantId: string, ref: { id?: string; idSuffix?: string }) {
  if (!ref.id && !ref.idSuffix) return null
  const q = await storefrontDb.b2BQuote.findFirst({
    where: { tenantId, ...(ref.id ? { id: ref.id } : { id: { endsWith: ref.idSuffix } }) },
    select: {
      id: true,
      status: true,
      customerRef: true,
      notes: true,
      convertedOrderId: true,
      rejectionReason: true,
      approvedAt: true,
      createdAt: true,
      lines: {
        select: { lineNo: true, skuCode: true, description: true, qty: true, unitPrice: true },
        orderBy: { lineNo: 'asc' },
      },
    },
  })
  if (!q) return null
  const names = await customerNames(tenantId, [q.customerRef])
  const lines = q.lines.map((l) => ({
    lineNo: l.lineNo,
    skuCode: l.skuCode,
    description: l.description,
    qty: l.qty,
    unitPrice: num(l.unitPrice),
  }))
  return {
    id: q.id,
    quoteNumber: quoteNumberOf(q.id),
    status: q.status,
    customerName: names.get(q.customerRef) ?? null,
    convertedOrderId: q.convertedOrderId,
    rejectionReason: q.rejectionReason,
    approvedAt: q.approvedAt,
    createdAt: q.createdAt,
    lines,
    quoteTotal: roundMoney(lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)),
  }
}
