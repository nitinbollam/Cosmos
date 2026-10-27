/**
 * Fixed, SELECT-only ERP reads for Celestial. Every query is tenant-scoped, projects a fixed set of
 * fields, orders deterministically and pages at PAGE_SIZE with an all-match count. Nothing here
 * creates, syncs, notifies or audits — the shared services those reads live beside do, so Celestial
 * keeps its own projections instead of calling them.
 */
import { crmDb, inventoryDb, orderDb, purchasingDb, storefrontDb } from '../db'
import {
  OPEN_PO_STATUSES,
  SALES_EXCLUDED_STATUSES,
  forecastFromQuarters,
  quarterLabel,
  quarterOf,
  quarterRange,
  shiftQuarter,
  type SalesForecast,
  type SalesPeriod,
  OUTSTANDING_BILL_STATUSES,
  PAGE_SIZE,
  caseVariants,
  singularWord,
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
/** Ranking compares every matching SKU, up to this many; beyond it the answer says it is partial. */
const STOCK_RANK_SKU_LIMIT = 1000
const STOCK_RANK_SHOWN = 10
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
  return caseVariants(singularWord(term)).map((v) => ({ [field]: { contains: v } }))
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

export type StockSummary = { skuId: string; code: string; name: string; unit: string; available: number; onHand: number }

export async function inventoryStock(
  tenantId: string,
  q: { tokens: string[]; rank?: SortDirection; warehouseIds?: string[] },
): Promise<{
  rows: StockRow[]
  totalRows: number
  skuSummaries: StockSummary[]
  matchedSkus: number
  rank?: SortDirection
  /** SKUs with no stock-level rows at all (shown separately from zero stock). */
  noStockRecorded: number
  rankTruncated: boolean
}> {
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
      take: q.rank ? STOCK_RANK_SKU_LIMIT : STOCK_SKU_LIMIT,
    }),
    inventoryDb.sKU.count({ where }),
  ])
  const empty = { rank: q.rank, noStockRecorded: 0, rankTruncated: false }
  if (skus.length === 0) return { rows: [], totalRows: 0, skuSummaries: [], matchedSkus, ...empty }

  const levels = await inventoryDb.stockLevel.findMany({
    where: { tenantId, skuId: { in: skus.map((s) => s.id) }, ...(q.warehouseIds ? { warehouseId: { in: q.warehouseIds } } : {}) },
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
        skuId: s.id,
        code: s.code,
        name: s.name,
        unit: s.unitOfMeasure,
        available: mine.reduce((acc, r) => acc + r.available, 0),
        onHand: mine.reduce((acc, r) => acc + r.onHand, 0),
      }
    })

  const noStockRecorded = skus.length - skuSummaries.length
  if (q.rank) {
    const dir = q.rank === 'asc' ? 1 : -1
    skuSummaries.sort((a, b) => dir * (a.available - b.available) || a.code.localeCompare(b.code))
    return {
      rows: [],
      totalRows: rows.length,
      skuSummaries: skuSummaries.slice(0, STOCK_RANK_SHOWN),
      matchedSkus,
      rank: q.rank,
      noStockRecorded,
      rankTruncated: matchedSkus > skus.length,
    }
  }
  return {
    rows: rows.slice(0, STOCK_ROW_LIMIT),
    totalRows: rows.length,
    skuSummaries,
    matchedSkus,
    noStockRecorded,
    rankTruncated: false,
  }
}

// ── search_catalog ──────────────────────────────────────────────────────────

export type CatalogRow = { id: string; code: string; name: string; unit: string; price: number; available: number | null }

/** Active SKUs whose name or code contains every token, with stock summed across warehouses. */
export async function catalogSearch(
  tenantId: string,
  tokens: string[],
  pageNo?: number,
  priceRank?: SortDirection,
): Promise<Page<CatalogRow>> {
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
      orderBy: priceRank ? [{ price: priceRank }, { code: 'asc' }] : [{ code: 'asc' }, { id: 'asc' }],
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
  /** Any of these statuses (e.g. every not-yet-shipped status); used when `status` is unset. */
  statuses?: OrderStatusFilter[]
  /** Order by total amount instead of date ("biggest order"). */
  byAmount?: boolean
  customerIds?: string[]
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
    ...(f.status ? { status: f.status } : f.statuses?.length ? { status: { in: f.statuses } } : {}),
    ...(f.customerIds ? { customerId: { in: f.customerIds } } : {}),
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
      orderBy: f.byAmount ? [{ totalAmount: dir }, { id: dir }] : [{ createdAt: dir }, { id: dir }],
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
  f: { status?: PoStatusFilter; statuses?: PoStatusFilter[]; supplier?: string; dateRange?: DateRange; page?: number },
): Promise<Page<PurchaseOrderListRow>> {
  const { page, skip } = skipFor(f.page)
  const supplierIds = await supplierIdsMatching(tenantId, f.supplier)
  if (supplierIds && supplierIds.length === 0) return { rows: [], total: 0, page, pageSize: PAGE_SIZE }
  const where = {
    tenantId,
    ...(f.status ? { status: f.status } : f.statuses?.length ? { status: { in: f.statuses } } : {}),
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
  f: { status?: QuoteStatusFilter; dateRange?: DateRange; page?: number; customerIds?: string[] },
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

// ── sales.summary / sales.forecast ──────────────────────────────────────────

/** Orders read per sales query; beyond this the totals say they are partial. */
const SALES_ORDER_CAP = 50_000
const DAY_MS = 24 * 60 * 60 * 1000

function monthBuckets(from: Date, to: Date): SalesPeriod[] {
  const out: SalesPeriod[] = []
  let y = from.getUTCFullYear()
  let m = from.getUTCMonth()
  while (Date.UTC(y, m, 1) < to.getTime()) {
    const start = new Date(Math.max(Date.UTC(y, m, 1), from.getTime()))
    const end = new Date(Math.min(Date.UTC(y, m + 1, 1), to.getTime()))
    out.push({ label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), from: start, to: end, orders: 0, revenue: 0 })
    m += 1
    if (m === 12) {
      m = 0
      y += 1
    }
  }
  return out
}

function quarterBuckets(from: Date, to: Date): SalesPeriod[] {
  const out: SalesPeriod[] = []
  for (let q = quarterOf(from); quarterRange(q).from < to; q = shiftQuarter(q, 1)) {
    const r = quarterRange(q)
    const start = new Date(Math.max(r.from.getTime(), from.getTime()))
    const end = new Date(Math.min(r.to.getTime(), to.getTime()))
    out.push({ label: quarterLabel(q), from: start, to: end, orders: 0, revenue: 0 })
  }
  return out
}

/** Sum non-cancelled orders into the given buckets. */
async function fillSales(tenantId: string, buckets: SalesPeriod[]): Promise<{ truncated: boolean }> {
  if (buckets.length === 0) return { truncated: false }
  const from = buckets[0].from
  const to = buckets[buckets.length - 1].to
  const orders = await orderDb.order.findMany({
    where: { tenantId, status: { notIn: SALES_EXCLUDED_STATUSES }, createdAt: { gte: from, lt: to } },
    select: { createdAt: true, totalAmount: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: SALES_ORDER_CAP + 1,
  })
  for (const o of orders.slice(0, SALES_ORDER_CAP)) {
    const b = buckets.find((p) => o.createdAt >= p.from && o.createdAt < p.to)
    if (!b) continue
    b.orders += 1
    b.revenue = roundMoney(b.revenue + num(o.totalAmount))
  }
  return { truncated: orders.length > SALES_ORDER_CAP }
}

export type SalesSummary = {
  label: string
  granularity: 'month' | 'quarter'
  periods: SalesPeriod[]
  totalOrders: number
  totalRevenue: number
  /** Revenue ÷ orders over the period; null with no orders. */
  averageOrderValue: number | null
  truncated: boolean
  excludedStatuses: string[]
}

/**
 * Revenue and order counts per month (ranges up to a quarter) or per quarter. Without a range: the
 * last four full quarters plus this quarter so far. Amounts are order totals as recorded; orders
 * store no currency, so none is implied.
 */
export async function salesSummary(tenantId: string, f: { dateRange?: DateRange }, now = new Date()): Promise<SalesSummary> {
  const current = quarterOf(now)
  const from = f.dateRange?.from ?? quarterRange(shiftQuarter(current, -4)).from
  const rangeEnd = f.dateRange?.to ?? quarterRange(current).to
  const to = new Date(Math.min(rangeEnd.getTime(), now.getTime() + DAY_MS))
  const granularity = to.getTime() - from.getTime() <= 93 * DAY_MS ? 'month' : 'quarter'
  const periods = to > from ? (granularity === 'month' ? monthBuckets(from, to) : quarterBuckets(from, to)) : []
  const { truncated } = await fillSales(tenantId, periods)
  return {
    label: f.dateRange?.label ?? 'last 4 quarters and this quarter so far',
    granularity,
    periods,
    totalOrders: periods.reduce((a, p) => a + p.orders, 0),
    totalRevenue: roundMoney(periods.reduce((a, p) => a + p.revenue, 0)),
    averageOrderValue: (() => {
      const n = periods.reduce((a, p) => a + p.orders, 0)
      return n > 0 ? roundMoney(periods.reduce((a, p) => a + p.revenue, 0) / n) : null
    })(),
    truncated,
    excludedStatuses: SALES_EXCLUDED_STATUSES,
  }
}

export type SalesForecastResult = SalesForecast & {
  target: string
  currentQuarter: SalesPeriod
  excludedStatuses: string[]
}

/** Next-quarter projection from full past quarters; refuses when there is too little history. */
export async function salesForecast(tenantId: string, now = new Date()): Promise<SalesForecastResult> {
  const current = quarterOf(now)
  const past: SalesPeriod[] = Array.from({ length: 8 }, (_, i) => shiftQuarter(current, i - 8)).map((q) => {
    const r = quarterRange(q)
    return { label: r.label, from: r.from, to: r.to, orders: 0, revenue: 0 }
  })
  const currentQuarter: SalesPeriod = {
    label: `${quarterLabel(current)} so far`,
    from: quarterRange(current).from,
    to: new Date(now.getTime() + 1),
    orders: 0,
    revenue: 0,
  }
  const [firstSale] = await Promise.all([
    orderDb.order.findFirst({
      where: { tenantId, status: { notIn: SALES_EXCLUDED_STATUSES } },
      select: { createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    fillSales(tenantId, past),
    fillSales(tenantId, [currentQuarter]),
  ])
  return {
    ...forecastFromQuarters(past, firstSale?.createdAt ?? null),
    target: quarterLabel(shiftQuarter(current, 1)),
    currentQuarter,
    excludedStatuses: SALES_EXCLUDED_STATUSES,
  }
}

// ── sales.by_product ────────────────────────────────────────────────────────

const SALES_RANK_SHOWN = 10

export type ProductSalesRow = { skuId: string; code: string; name: string; unit: string; units: number; revenue: number }

export type ProductSales = {
  label: string
  rank: SortDirection
  rows: ProductSalesRow[]
  /** Products in the ranking (sold, plus never-sold active products when ranking lowest first). */
  ranked: number
  truncated: boolean
  excludedStatuses: string[]
}

/**
 * Products ranked by line revenue (units × unit price, net of returned units, before tax) on orders
 * that weren't cancelled, failed or returned. Without a range: the last four full quarters plus this
 * quarter so far. Ranking lowest first includes active products that sold nothing in the period.
 */
export async function salesByProduct(
  tenantId: string,
  f: { dateRange?: DateRange; rank?: SortDirection; tokens?: string[] },
  now = new Date(),
): Promise<ProductSales> {
  const rank = f.rank ?? 'desc'
  const current = quarterOf(now)
  const from = f.dateRange?.from ?? quarterRange(shiftQuarter(current, -4)).from
  const to = f.dateRange?.to ?? quarterRange(current).to
  const tokens = f.tokens ?? []

  const skuWhere = {
    tenantId,
    ...(tokens.length ? { AND: tokens.map((t) => ({ OR: [...containsAny('name', t), ...containsAny('code', t)] })) } : {}),
  }
  const lines = await orderDb.orderLineItem.findMany({
    where: { order: { tenantId, status: { notIn: SALES_EXCLUDED_STATUSES }, createdAt: { gte: from, lt: to } } },
    select: { skuId: true, quantity: true, returnedQty: true, unitPrice: true },
    take: SALES_ORDER_CAP + 1,
  })
  const truncated = lines.length > SALES_ORDER_CAP
  const bySku = new Map<string, { units: number; revenue: number }>()
  for (const l of lines.slice(0, SALES_ORDER_CAP)) {
    const units = Math.max(0, l.quantity - l.returnedQty)
    const cur = bySku.get(l.skuId) ?? { units: 0, revenue: 0 }
    cur.units += units
    cur.revenue = roundMoney(cur.revenue + units * num(l.unitPrice))
    bySku.set(l.skuId, cur)
  }

  // Ranking lowest first should surface products that sold nothing, so include active SKUs too.
  const skus = await inventoryDb.sKU.findMany({
    where: rank === 'asc' ? { ...skuWhere, OR: [{ isActive: true }, { id: { in: [...bySku.keys()] } }] } : { ...skuWhere, id: { in: [...bySku.keys()] } },
    select: { id: true, code: true, name: true, unitOfMeasure: true },
    take: STOCK_RANK_SKU_LIMIT,
  })
  const dir = rank === 'asc' ? 1 : -1
  const rows = skus
    .map((s) => ({
      skuId: s.id,
      code: s.code,
      name: s.name,
      unit: s.unitOfMeasure,
      units: bySku.get(s.id)?.units ?? 0,
      revenue: bySku.get(s.id)?.revenue ?? 0,
    }))
    .sort((a, b) => dir * (a.revenue - b.revenue) || dir * (a.units - b.units) || a.code.localeCompare(b.code))

  return {
    label: f.dateRange?.label ?? 'last 4 quarters and this quarter so far',
    rank,
    rows: rows.slice(0, SALES_RANK_SHOWN),
    ranked: rows.length,
    truncated,
    excludedStatuses: SALES_EXCLUDED_STATUSES,
  }
}

// ── customers, suppliers, warehouses ────────────────────────────────────────

/** Customer ids whose name contains every word of `name` (case-insensitive across databases). */
export async function resolveCustomerIds(tenantId: string, name: string): Promise<string[]> {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 4)
  if (words.length === 0) return []
  const rows = await crmDb.customer.findMany({
    where: { tenantId, AND: words.map((w) => ({ OR: containsAny('name', w) })) },
    select: { id: true },
    take: 50,
  })
  return rows.map((r) => r.id)
}

export type CustomerSalesRow = { customerId: string; name: string; orders: number; revenue: number }

/** Customers ranked by order revenue (non-cancelled orders) over the period. */
export async function salesByCustomer(
  tenantId: string,
  f: { dateRange?: DateRange; rank?: SortDirection },
  now = new Date(),
): Promise<{ label: string; rank: SortDirection; rows: CustomerSalesRow[]; ranked: number; truncated: boolean; excludedStatuses: string[] }> {
  const rank = f.rank ?? 'desc'
  const current = quarterOf(now)
  const from = f.dateRange?.from ?? quarterRange(shiftQuarter(current, -4)).from
  const to = f.dateRange?.to ?? quarterRange(current).to
  const orders = await orderDb.order.findMany({
    where: { tenantId, status: { notIn: SALES_EXCLUDED_STATUSES }, createdAt: { gte: from, lt: to } },
    select: { customerId: true, totalAmount: true },
    take: SALES_ORDER_CAP + 1,
  })
  const byCustomer = new Map<string, { orders: number; revenue: number }>()
  for (const o of orders.slice(0, SALES_ORDER_CAP)) {
    const cur = byCustomer.get(o.customerId) ?? { orders: 0, revenue: 0 }
    cur.orders += 1
    cur.revenue = roundMoney(cur.revenue + num(o.totalAmount))
    byCustomer.set(o.customerId, cur)
  }
  const names = await customerNames(tenantId, [...byCustomer.keys()])
  const dir = rank === 'asc' ? 1 : -1
  const rows = [...byCustomer.entries()]
    .map(([customerId, v]) => ({ customerId, name: names.get(customerId) ?? customerId, ...v }))
    .sort((a, b) => dir * (a.revenue - b.revenue) || dir * (a.orders - b.orders) || a.name.localeCompare(b.name))
  return {
    label: f.dateRange?.label ?? 'last 4 quarters and this quarter so far',
    rank,
    rows: rows.slice(0, SALES_RANK_SHOWN),
    ranked: rows.length,
    truncated: orders.length > SALES_ORDER_CAP,
    excludedStatuses: SALES_EXCLUDED_STATUSES,
  }
}

export type SupplierRow = {
  id: string
  code: string
  name: string
  email: string | null
  phone: string | null
  purchaseOrders: number
  openPurchaseOrders: number
  openBalanceByCurrency: Record<string, number>
}

/** Suppliers with their purchase-order counts and what is still owed to them. */
export async function suppliersList(tenantId: string): Promise<{ rows: SupplierRow[]; total: number }> {
  const [suppliers, total] = await Promise.all([
    purchasingDb.supplier.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true, email: true, phone: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 50,
    }),
    purchasingDb.supplier.count({ where: { tenantId } }),
  ])
  const ids = suppliers.map((x) => x.id)
  const [pos, bills] = ids.length
    ? await Promise.all([
        purchasingDb.purchaseOrder.findMany({ where: { tenantId, supplierId: { in: ids } }, select: { supplierId: true, status: true } }),
        purchasingDb.vendorBill.findMany({
          where: { tenantId, supplierId: { in: ids }, status: { in: OUTSTANDING_BILL_STATUSES } },
          select: { supplierId: true, currency: true, totalAmount: true, amountPaid: true },
        }),
      ])
    : [[], []]
  const open = new Set<string>(OPEN_PO_STATUSES)
  return {
    rows: suppliers.map((x) => ({
      ...x,
      purchaseOrders: pos.filter((p) => p.supplierId === x.id).length,
      openPurchaseOrders: pos.filter((p) => p.supplierId === x.id && open.has(p.status)).length,
      openBalanceByCurrency: sumByCurrency(
        bills.filter((b) => b.supplierId === x.id).map((b) => ({ currency: b.currency, amount: num(b.totalAmount) - num(b.amountPaid) })),
      ),
    })),
    total,
  }
}

export type WarehouseStockRow = { warehouseId: string; code: string; name: string; skus: number; available: number; onHand: number }

/** Stock totals per warehouse (all units summed, so mixed units of measure are noted by the caller). */
export async function stockByWarehouse(tenantId: string, rank: SortDirection = 'desc'): Promise<{ rows: WarehouseStockRow[]; units: string[] }> {
  const [levels, warehouses] = await Promise.all([
    inventoryDb.stockLevel.findMany({
      where: { tenantId },
      select: { warehouseId: true, skuId: true, quantityAvailable: true, quantityOnHand: true },
      take: 100_000,
    }),
    inventoryDb.warehouse.findMany({ where: { tenantId, isActive: true }, select: { id: true, code: true, name: true } }),
  ])
  const skuIds = [...new Set(levels.map((l) => l.skuId))]
  const units = skuIds.length
    ? [...new Set((await inventoryDb.sKU.findMany({ where: { tenantId, id: { in: skuIds } }, select: { unitOfMeasure: true } })).map((u) => u.unitOfMeasure))]
    : []
  const dir = rank === 'asc' ? 1 : -1
  const rows = warehouses
    .map((w) => {
      const mine = levels.filter((l) => l.warehouseId === w.id)
      return {
        warehouseId: w.id,
        code: w.code,
        name: w.name,
        skus: new Set(mine.filter((l) => l.quantityOnHand > 0).map((l) => l.skuId)).size,
        available: mine.reduce((a, l) => a + l.quantityAvailable, 0),
        onHand: mine.reduce((a, l) => a + l.quantityOnHand, 0),
      }
    })
    .sort((a, b) => dir * (a.available - b.available) || a.code.localeCompare(b.code))
  return { rows, units }
}

/** Active warehouses whose name or code contains every word of `name`. */
export async function resolveWarehouses(tenantId: string, name: string): Promise<Array<{ id: string; name: string }>> {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 4)
  if (words.length === 0) return []
  return inventoryDb.warehouse.findMany({
    where: { tenantId, isActive: true, AND: words.map((w) => ({ OR: [...containsAny('name', w), ...containsAny('code', w)] })) },
    select: { id: true, name: true },
    take: 10,
  })
}
