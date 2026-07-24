import { analyticsDb } from './db'
import { ApiError } from './session'
import * as orders from './orders'
import * as invoices from './invoices'
import * as inv from './inventory'
import * as crm from './crm'

export const REPORT_TYPES = ['ORDERS', 'INVENTORY', 'AR_AGING'] as const
export type ReportType = (typeof REPORT_TYPES)[number]

export type ReportFilters = {
  status?: string
  channel?: string
  search?: string
  fromIso?: string
  toIso?: string
  customerId?: string
  category?: string
  warehouseId?: string
  inStockOnly?: boolean
  lowStockOnly?: boolean
  openOnly?: boolean
}

export type ReportColumn = { key: string; label: string }
export type ReportRow = Record<string, string | number | boolean | null>

export type RunReportResult = {
  type: ReportType
  columns: ReportColumn[]
  rows: ReportRow[]
  summary?: Record<string, number>
  truncated: boolean
}

const MAX_EXPORT_ROWS = 5000
const PAGE_SIZE = 100

const ORDER_COLUMNS: ReportColumn[] = [
  { key: 'id', label: 'Order ID' },
  { key: 'customerId', label: 'Customer ID' },
  { key: 'customerName', label: 'Customer' },
  { key: 'status', label: 'Status' },
  { key: 'channel', label: 'Channel' },
  { key: 'totalAmount', label: 'Total' },
  { key: 'amountPaid', label: 'Paid' },
  { key: 'lineCount', label: 'Lines' },
  { key: 'createdAt', label: 'Created' },
]

const INVENTORY_COLUMNS: ReportColumn[] = [
  { key: 'code', label: 'SKU' },
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Category' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'onHand', label: 'On hand' },
  { key: 'reserved', label: 'Reserved' },
  { key: 'available', label: 'Available' },
  { key: 'reorderPoint', label: 'Reorder point' },
  { key: 'isActive', label: 'Active' },
  { key: 'unitOfMeasure', label: 'UOM' },
]

const AR_AGING_COLUMNS: ReportColumn[] = [
  { key: 'invoiceNumber', label: 'Invoice' },
  { key: 'customerId', label: 'Customer ID' },
  { key: 'customerName', label: 'Customer' },
  { key: 'issuedAt', label: 'Issued' },
  { key: 'totalAmount', label: 'Total' },
  { key: 'amountPaid', label: 'Paid' },
  { key: 'balance', label: 'Balance' },
  { key: 'daysOutstanding', label: 'Days' },
  { key: 'bucket', label: 'Bucket' },
  { key: 'displayStatus', label: 'Status' },
]

export function isReportType(raw: unknown): raw is ReportType {
  return typeof raw === 'string' && (REPORT_TYPES as readonly string[]).includes(raw)
}

export function reportCatalog() {
  return [
    {
      type: 'ORDERS' as const,
      label: 'Orders',
      description: 'Order list with status, channel, and totals',
      columns: ORDER_COLUMNS,
      filters: ['status', 'channel', 'search', 'fromIso', 'toIso', 'customerId'],
    },
    {
      type: 'INVENTORY' as const,
      label: 'Inventory',
      description: 'SKU stock on hand / available with reorder points',
      columns: INVENTORY_COLUMNS,
      filters: ['search', 'category', 'warehouseId', 'inStockOnly', 'lowStockOnly'],
    },
    {
      type: 'AR_AGING' as const,
      label: 'AR aging',
      description: 'Open invoice balances by days outstanding',
      columns: AR_AGING_COLUMNS,
      filters: ['customerId', 'openOnly'],
    },
  ]
}

export function normalizeFilters(raw: unknown): ReportFilters {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const str = (k: string) => {
    const v = o[k]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }
  const bool = (k: string) => {
    const v = o[k]
    if (typeof v === 'boolean') return v
    if (v === 'true' || v === '1') return true
    if (v === 'false' || v === '0') return false
    return undefined
  }
  return {
    status: str('status'),
    channel: str('channel'),
    search: str('search'),
    fromIso: str('fromIso') ?? str('from'),
    toIso: str('toIso') ?? str('to'),
    customerId: str('customerId'),
    category: str('category'),
    warehouseId: str('warehouseId'),
    inStockOnly: bool('inStockOnly'),
    lowStockOnly: bool('lowStockOnly'),
    openOnly: bool('openOnly') ?? true,
  }
}

export function agingBucket(days: number): string {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  if (days <= 120) return '91-120'
  return '120+'
}

export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

export function rowsToCsv(columns: ReportColumn[], rows: ReportRow[]): string {
  const header = columns.map((c) => csvEscape(c.label)).join(',')
  const body = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(','))
  return [header, ...body].join('\n')
}

async function customerNameMap(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const map = new Map<string, string>()
  if (unique.length === 0) return map
  try {
    const all = await crm.listCustomers(tenantId)
    for (const c of all) {
      if (unique.includes(c.id)) map.set(c.id, c.name)
    }
  } catch {
    /* CRM unavailable — leave blank */
  }
  return map
}

async function runOrdersReport(tenantId: string, filters: ReportFilters): Promise<RunReportResult> {
  const rows: ReportRow[] = []
  let page = 1
  let truncated = false
  while (rows.length < MAX_EXPORT_ROWS) {
    const res = await orders.listOrders(tenantId, page, PAGE_SIZE, {
      status: filters.status,
      channel: filters.channel,
      search: filters.search,
      fromIso: filters.fromIso,
      toIso: filters.toIso,
      customerId: filters.customerId,
    })
    for (const o of res.items) {
      rows.push({
        id: o.id,
        customerId: o.customerId,
        customerName: null,
        status: o.status,
        channel: o.channel,
        totalAmount: Number(o.totalAmount),
        amountPaid: Number(o.amountPaid ?? 0),
        lineCount: o.lineItems?.length ?? 0,
        createdAt: o.createdAt.toISOString(),
      })
      if (rows.length >= MAX_EXPORT_ROWS) {
        truncated = true
        break
      }
    }
    if (!res.hasMore || res.items.length === 0) break
    page += 1
  }
  const names = await customerNameMap(
    tenantId,
    rows.map((r) => String(r.customerId ?? '')),
  )
  for (const r of rows) {
    r.customerName = names.get(String(r.customerId ?? '')) ?? null
  }
  return { type: 'ORDERS', columns: ORDER_COLUMNS, rows, truncated }
}

async function runInventoryReport(tenantId: string, filters: ReportFilters): Promise<RunReportResult> {
  const rows: ReportRow[] = []
  let page = 1
  let truncated = false
  while (rows.length < MAX_EXPORT_ROWS) {
    const res = await inv.listSkus(tenantId, page, PAGE_SIZE, filters.search, {
      category: filters.category,
      warehouseId: filters.warehouseId,
      inStockOnly: filters.inStockOnly,
    })
    for (const sku of res.items) {
      const onHand = Number(sku.quantityOnHand ?? 0)
      const reserved = Number(sku.quantityReserved ?? 0)
      const available = Number(sku.quantityAvailable ?? 0)
      const reorderPoint = Number(sku.reorderPoint ?? 0)
      if (filters.lowStockOnly && !(reorderPoint > 0 && available <= reorderPoint)) {
        continue
      }
      rows.push({
        code: sku.code,
        name: sku.name,
        category: sku.category,
        barcode: sku.barcode ?? null,
        onHand,
        reserved,
        available,
        reorderPoint,
        isActive: sku.isActive,
        unitOfMeasure: sku.unitOfMeasure,
      })
      if (rows.length >= MAX_EXPORT_ROWS) {
        truncated = true
        break
      }
    }
    if (!res.hasMore || res.items.length === 0) break
    page += 1
  }
  return { type: 'INVENTORY', columns: INVENTORY_COLUMNS, rows, truncated }
}

async function runArAgingReport(tenantId: string, filters: ReportFilters): Promise<RunReportResult> {
  const openOnly = filters.openOnly !== false
  const rows: ReportRow[] = []
  const summary: Record<string, number> = {
    '0-30': 0,
    '31-60': 0,
    '61-90': 0,
    '91-120': 0,
    '120+': 0,
    totalOpen: 0,
  }
  let page = 1
  let truncated = false
  const now = Date.now()

  while (rows.length < MAX_EXPORT_ROWS) {
    const res = await invoices.listInvoices(tenantId, page, PAGE_SIZE, {
      customerId: filters.customerId,
    })
    for (const invRow of res.items) {
      if (invRow.order?.status === 'CANCELLED') continue
      const balance = Number(invRow.balance)
      if (openOnly && balance <= 0.01) continue
      const days = Math.max(0, Math.floor((now - new Date(invRow.issuedAt).getTime()) / 86_400_000))
      const bucket = agingBucket(days)
      if (balance > 0.01) {
        summary[bucket] = (summary[bucket] ?? 0) + balance
        summary.totalOpen += balance
      }
      rows.push({
        invoiceNumber: invRow.invoiceNumber,
        customerId: invRow.customerId,
        customerName: null,
        issuedAt: new Date(invRow.issuedAt).toISOString().slice(0, 10),
        totalAmount: Number(invRow.totalAmount),
        amountPaid: Number(invRow.amountPaid),
        balance,
        daysOutstanding: days,
        bucket,
        displayStatus: invRow.displayStatus,
      })
      if (rows.length >= MAX_EXPORT_ROWS) {
        truncated = true
        break
      }
    }
    if (!res.hasMore || res.items.length === 0) break
    page += 1
  }

  const names = await customerNameMap(
    tenantId,
    rows.map((r) => String(r.customerId ?? '')),
  )
  for (const r of rows) {
    r.customerName = names.get(String(r.customerId ?? '')) ?? null
  }

  return { type: 'AR_AGING', columns: AR_AGING_COLUMNS, rows, summary, truncated }
}

export async function runReport(
  tenantId: string,
  type: ReportType,
  filtersInput?: unknown,
): Promise<RunReportResult> {
  const filters = normalizeFilters(filtersInput)
  if (type === 'ORDERS') return runOrdersReport(tenantId, filters)
  if (type === 'INVENTORY') return runInventoryReport(tenantId, filters)
  return runArAgingReport(tenantId, filters)
}

export function toCsvResponse(result: RunReportResult, filename: string): Response {
  const csv = rowsToCsv(result.columns, result.rows)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Report-Truncated': result.truncated ? '1' : '0',
      'X-Report-Row-Count': String(result.rows.length),
    },
  })
}

function serializeSaved(row: {
  id: string
  tenantId: string
  userId: string
  name: string
  type: string
  filters: unknown
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    name: row.name,
    type: row.type as ReportType,
    filters: normalizeFilters(row.filters),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listSavedReports(tenantId: string, userId?: string) {
  const rows = await analyticsDb.savedReport.findMany({
    where: { tenantId, ...(userId ? { userId } : {}) },
    orderBy: { updatedAt: 'desc' },
  })
  return rows.map(serializeSaved)
}

export async function getSavedReport(tenantId: string, id: string) {
  const row = await analyticsDb.savedReport.findFirst({ where: { id, tenantId } })
  if (!row) throw new ApiError(404, 'Saved report not found')
  return serializeSaved(row)
}

export async function createSavedReport(
  tenantId: string,
  userId: string,
  input: { name: string; type: ReportType; filters?: unknown },
) {
  const name = input.name?.trim()
  if (!name) throw new ApiError(400, 'name is required')
  if (!isReportType(input.type)) throw new ApiError(400, 'Invalid report type')
  const filters = normalizeFilters(input.filters)
  const row = await analyticsDb.savedReport.create({
    data: {
      tenantId,
      userId,
      name,
      type: input.type,
      filters,
    },
  })
  return serializeSaved(row)
}

export async function updateSavedReport(
  tenantId: string,
  id: string,
  patch: { name?: string; filters?: unknown },
) {
  await getSavedReport(tenantId, id)
  const data: { name?: string; filters?: ReportFilters } = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new ApiError(400, 'name is required')
    data.name = name
  }
  if (patch.filters !== undefined) data.filters = normalizeFilters(patch.filters)
  const row = await analyticsDb.savedReport.update({ where: { id }, data })
  return serializeSaved(row)
}

export async function deleteSavedReport(tenantId: string, id: string) {
  await getSavedReport(tenantId, id)
  await analyticsDb.savedReport.delete({ where: { id } })
  return { ok: true }
}

export async function runSavedReport(tenantId: string, id: string) {
  const saved = await getSavedReport(tenantId, id)
  return runReport(tenantId, saved.type, saved.filters)
}
