import type { ToolResult } from './tools'
import type {
  BillRow,
  CatalogRow,
  OrderListRow,
  Page,
  PurchaseOrderListRow,
  QuoteListRow,
  StockRow,
  StockSummary,
  ordersDetail,
  purchasingOrderDetail,
  quotesDetail,
} from './erp-queries'

type WarehouseRow = {
  code: string
  name: string
  address?: string | null
  city?: string | null
  isDefault?: boolean
}

type InvoiceRow = {
  invoiceNumber: string
  status: string
  total: number
  balance?: number
}

type SkuRow = {
  code: string
  name: string
  available?: number
  price?: number
  reorderPoint?: number
}

type GlobalSearchData = {
  orders?: Array<{ id: string; status: string; totalAmount: unknown; createdAt: string | Date }>
  customers?: Array<{ id: string; name: string; email?: string | null }>
  skus?: Array<{ code: string; name: string; price?: unknown }>
  quotes?: Array<{ id: string; status: string }>
}

type Filtered<T> = Page<T> & { filters?: string[] }

export function composeFromToolResults(toolResults: ToolResult[]): string {
  if (toolResults.length === 0) {
    return ''
  }

  const sections = toolResults.filter(toolResultHasData).map(formatToolSection).filter(Boolean)
  if (sections.length === 0) {
    return ''
  }

  return sections.join('\n\n')
}

/**
 * True when a result has something to show the user directly — records, an explicit "no matches"
 * from a list query, or a notice (clarifying question / access explanation).
 */
export function toolResultHasData(result: ToolResult): boolean {
  if (result.notice) return true
  if (result.error) return false
  if (result.name === 'global_search') {
    const data = result.data as GlobalSearchData
    return (
      (data?.orders?.length ?? 0) > 0 ||
      (data?.customers?.length ?? 0) > 0 ||
      (data?.skus?.length ?? 0) > 0 ||
      (data?.quotes?.length ?? 0) > 0
    )
  }
  if (Array.isArray(result.data)) return result.data.length > 0
  // Paged list results and single-record details both answer the question, even with zero rows.
  return result.data != null && typeof result.data === 'object'
}

function simplifyDocExcerpt(body: string, plainLanguage: boolean): string {
  if (!plainLanguage) {
    return body.length > 700 ? `${body.slice(0, 700).trim()}…` : body
  }

  const lines = body
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^```/.test(t)) return false
      if (/\b(npm run|localhost|apps\/|prisma|schema\.prisma|\/admin\/|\/m\/|\/catalog)\b/i.test(t)) return false
      if (/^\|.*\|.*\|/.test(t) && /route|url|stack|schema/i.test(t)) return false
      return true
    })

  const cleaned = lines.join('\n').trim()
  const excerpt = cleaned.length > 700 ? `${cleaned.slice(0, 700).trim()}…` : cleaned
  return excerpt || body.slice(0, 700)
}

export function buildDocFallbackReply(
  message: string,
  docs: Array<{ heading: string; body: string }>,
  plainLanguage = true,
): string {
  if (docs.length === 0) {
    return [
      `I'm **Celestial**, your Pleros assistant.`,
      '',
      plainLanguage
        ? 'I can explain how Pleros helps you sell, ship, and get paid — or look up your orders, stock, and invoices.'
        : 'I can help with **orders**, **inventory**, **warehouses**, **finance**, **POS**, **quotes**, and how Pleros features work.',
      '',
      `You asked: "${message}"`,
      '',
      plainLanguage
        ? 'Try: "How does Pleros work?", "Any orders waiting to ship?", or "What\'s low on stock?"'
        : 'Try questions like "What warehouses do we have?", "Any orders pending?", or "How does POS work?"',
    ].join('\n')
  }

  const isTechnicalDoc = (doc: { heading: string; body: string }) =>
    /architecture|tech stack|local development|data model|api base/i.test(doc.heading) ||
    /\b(npm run|localhost:\d+|apps\/)/i.test(doc.body)

  const ranked = plainLanguage
    ? [...docs]
        .filter((d) => !isTechnicalDoc(d))
        .sort((a, b) => {
          const aPlain = /plain language|simple overview/i.test(a.heading) ? 1 : 0
          const bPlain = /plain language|simple overview/i.test(b.heading) ? 1 : 0
          return bPlain - aPlain
        })
    : docs

  const pool = ranked.length > 0 ? ranked : docs
  const sections = pool.slice(0, 2).map((doc) => {
    const excerpt = simplifyDocExcerpt(doc.body, plainLanguage)
    const heading = plainLanguage ? doc.heading.replace(/\s*—\s*how it works/i, '') : doc.heading
    return `### ${heading}\n${excerpt}`
  })

  return [
    plainLanguage
      ? 'Here’s a simple explanation based on how Pleros is set up for your business:'
      : 'Here is what Pleros documentation says about your question:',
    '',
    ...sections,
    '',
    plainLanguage
      ? 'Ask a follow-up if you want step-by-step help on a specific task, or ask me to look up live orders or stock.'
      : 'Ask a follow-up if you want steps for a specific screen or live data (orders, stock, warehouses).',
  ].join('\n')
}

/** @deprecated use composeFromToolResults */
export function tryComposeDirectReply(toolResults: ToolResult[], _userMessage: string): string | null {
  if (!toolResults.some(toolResultHasData)) return null
  const reply = composeFromToolResults(toolResults)
  return reply || null
}


type OrderDetail = NonNullable<Awaited<ReturnType<typeof ordersDetail>>>
type PoDetail = NonNullable<Awaited<ReturnType<typeof purchasingOrderDetail>>>
type QuoteDetail = NonNullable<Awaited<ReturnType<typeof quotesDetail>>>
type StockData = { rows: StockRow[]; totalRows: number; skuSummaries: StockSummary[]; matchedSkus: number; search?: string }
type BillsData = Filtered<BillRow> & { balanceByCurrency: Record<string, number>; totalsTruncated: boolean }

function formatToolSection(result: ToolResult): string | null {
  if (result.notice) return result.notice
  switch (result.name) {
    case 'list_warehouses':
      return formatWarehouses(result)
    case 'orders.list':
      return formatOrders(result.data as Filtered<OrderListRow>)
    case 'orders.detail':
      return formatOrderDetail(result.data as OrderDetail)
    case 'inventory.stock':
      return formatStock(result.data as StockData)
    case 'purchasing.orders':
      return formatPurchaseOrders(result.data as Filtered<PurchaseOrderListRow>)
    case 'purchasing.order_detail':
      return formatPurchaseOrderDetail(result.data as PoDetail)
    case 'finance.bills':
      return formatBills(result.data as BillsData)
    case 'quotes.list':
      return formatQuotes(result.data as Filtered<QuoteListRow>)
    case 'quotes.detail':
      return formatQuoteDetail(result.data as QuoteDetail)
    case 'list_my_invoices':
      return formatInvoices(result)
    case 'list_low_stock':
      return formatLowStock(result)
    case 'search_catalog':
      return formatCatalog(result.data as Page<CatalogRow> & { search?: string })
    case 'global_search':
      return formatGlobalSearch(result)
    default:
      return null
  }
}

function formatOrderCode(id: string, orderNumber?: number | null): string {
  if (orderNumber != null) return `ORD-${orderNumber}`
  if (!id) return ''
  if (id.startsWith('seed_ord_')) return `ORD-${id.replace('seed_ord_', '').toUpperCase()}`
  return `ORD-${id.slice(-6).toUpperCase()}`
}

/** Amount with its currency. Without a recorded currency the bare amount is shown — never a guessed symbol. */
function money(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null || Number.isNaN(amount)) return '—'
  const fixed = Number(amount).toFixed(2)
  if (!currency) return fixed
  return currency.toUpperCase() === 'USD' ? `$${fixed}` : `${fixed} ${currency.toUpperCase()}`
}

function filterSuffix(filters?: string[]): string {
  return filters && filters.length > 0 ? ` — ${filters.join(', ')}` : ''
}

/** "Showing 8 of 23" when the page is a subset of all matches. */
function countLine(shown: number, total: number): string {
  return total > shown ? `Showing ${shown} of ${total} matches.` : `${total} ${total === 1 ? 'match' : 'matches'}.`
}

function formatWarehouses(result: ToolResult): string {
  const rows = result.data as WarehouseRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Warehouses:** No active warehouses found in Pleros.'
  }
  const tableRows = rows.map(
    (w) => `| \`${w.code}\` | **${w.name}** | ${w.address ?? w.city ?? '—'} | ${w.isDefault ? '✓ Default' : '—'} |`,
  )
  const manageHref = result.links.find((l) => /warehouse|settings/i.test(l.href))?.href
  return [
    `**Warehouses** — ${rows.length} active:`,
    '',
    '| Code | Warehouse Name | Location | Status |',
    '| :--- | :--- | :--- | :--- |',
    ...tableRows,
    '',
    manageHref ? `*Manage warehouses and bin locations in [Warehouse Settings](${manageHref}).*` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatOrders(page: Filtered<OrderListRow>): string {
  if (page.rows.length === 0) {
    return `**Orders${filterSuffix(page.filters)}:** No matching orders found.`
  }
  const tableRows = page.rows.map(
    (o) =>
      `| **${formatOrderCode(o.id, o.orderNumber)}** | \`${o.status}\` | ${o.customerName ?? '—'} | ${money(o.totalAmount)} | ${formatDate(o.createdAt)} | ${o.lineCount} |`,
  )
  return [
    `### Orders${filterSuffix(page.filters)}`,
    countLine(page.rows.length, page.total),
    '',
    '| Order # | Status | Customer | Total | Created | Lines |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...tableRows,
    '',
    '*View and fulfill orders in [Orders](/admin/orders).*',
  ].join('\n')
}

function formatOrderDetail(o: OrderDetail): string {
  const code = formatOrderCode(o.id, o.orderNumber)
  const lineRows = o.lines.map(
    (l) =>
      `| ${l.skuCode ? `\`${l.skuCode}\`` : '—'} | ${l.skuName ?? '—'} | ${l.quantity} | ${l.allocated} | ${l.backordered} | ${money(l.unitPrice)} |`,
  )
  const shipments =
    o.shipments.length === 0
      ? ['No shipments recorded yet.']
      : o.shipments.map(
          (s) =>
            `- Shipment ${s.shipmentNo}: \`${s.status}\`${s.carrier ? ` via ${s.carrier}` : ''}${s.trackingNumber ? ` (tracking ${s.trackingNumber})` : ''} — ${s.shippedAt ? `shipped ${formatDate(s.shippedAt)}` : 'no ship date recorded'}`,
        )
  return [
    `### Order ${code}`,
    `- **Status:** \`${o.status}\` · **Channel:** ${o.channel} · **Priority:** ${o.priority}`,
    `- **Customer:** ${o.customerName ?? '—'}`,
    `- **Total:** ${money(o.totalAmount)} · **Paid:** ${money(o.amountPaid)}`,
    `- **Created:** ${formatDate(o.createdAt)}`,
    '',
    '| SKU | Item | Qty | Allocated | Backordered | Unit price |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...lineRows,
    '',
    '**Shipments**',
    ...shipments,
    '',
    `*Open [${code}](/admin/orders/${o.id}) for the full timeline and invoice.*`,
  ].join('\n')
}

function formatStock(d: StockData): string {
  const subject = d.search ? `matching “${d.search}”` : ''
  if (d.matchedSkus === 0) return `**Stock:** No products ${subject || 'found'}.`
  if (d.rows.length === 0) return `**Stock:** ${d.matchedSkus} product(s) ${subject} found, but no stock is recorded in any warehouse.`
  const tableRows = d.rows.map(
    (r) =>
      `| \`${r.code}\` | ${r.name} | ${r.warehouseName} | **${r.available}** ${r.unit} | ${r.onHand} | ${r.reserved} | ${r.reorderPoint || '—'} |`,
  )
  const summary =
    d.skuSummaries.length > 1
      ? ['', '**Total available by SKU:**', ...d.skuSummaries.map((s) => `- \`${s.code}\` ${s.name}: ${s.available} ${s.unit}`)]
      : []
  return [
    `### Stock by warehouse${subject ? ` ${subject}` : ''}`,
    d.totalRows > d.rows.length ? `Showing ${d.rows.length} of ${d.totalRows} SKU × warehouse rows.` : null,
    '',
    '| SKU | Item | Warehouse | Available | On hand | Reserved | Reorder point |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    ...tableRows,
    ...summary,
  ]
    .filter((l) => l != null)
    .join('\n')
}

function formatPurchaseOrders(page: Filtered<PurchaseOrderListRow>): string {
  if (page.rows.length === 0) return `**Purchase orders${filterSuffix(page.filters)}:** No matching purchase orders found.`
  const tableRows = page.rows.map(
    (po) =>
      `| **${po.number}** | \`${po.status}\` | ${po.supplierName} | ${po.qtyReceived}/${po.qtyOrdered} | ${po.goodsCost == null ? `unknown (${po.missingCostLines} line(s) without cost)` : money(po.goodsCost, po.currency)} | ${formatDate(po.createdAt)} |`,
  )
  return [
    `### Purchase orders${filterSuffix(page.filters)}`,
    countLine(page.rows.length, page.total),
    '',
    '| PO # | Status | Supplier | Received / ordered | Goods cost | Created |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...tableRows,
    '',
    '*Manage purchase orders in [Purchasing](/admin/purchasing).*',
  ].join('\n')
}

function formatPurchaseOrderDetail(po: PoDetail): string {
  const lineRows = po.lines.map(
    (l) =>
      `| ${l.lineNo} | ${l.skuCode ? `\`${l.skuCode}\`` : '—'} | ${l.description} | ${l.qtyReceived}/${l.qtyOrdered} | ${l.unitCost == null ? 'not recorded' : money(l.unitCost, po.currency)} |`,
  )
  const bills =
    po.bills.length === 0
      ? ['No vendor bill recorded for this PO.']
      : po.bills.map(
          (b) => `- **${b.billNumber}** \`${b.status}\` — total ${money(b.totalAmount, b.currency)}, balance ${money(b.balance, b.currency)}${b.dueAt ? `, due ${formatDate(b.dueAt)}` : ''}`,
        )
  return [
    `### Purchase order ${po.number}`,
    `- **Supplier:** ${po.supplierName} · **Status:** \`${po.status}\``,
    `- **Goods cost:** ${po.goodsCost == null ? `unknown — ${po.missingCostLines} line(s) have no unit cost` : money(po.goodsCost, po.currency)}`,
    '',
    '| Line | SKU | Description | Received / ordered | Unit cost |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...lineRows,
    '',
    '**Vendor bills**',
    ...bills,
    '',
    `*Open [${po.number}](/admin/purchasing/${po.id}) to receive goods or create a bill.*`,
  ].join('\n')
}

function formatBills(d: BillsData): string {
  if (d.rows.length === 0) return `**Vendor bills${filterSuffix(d.filters)}:** No matching bills found.`
  const tableRows = d.rows.map(
    (b) =>
      `| **${b.billNumber}** | \`${b.status}\` | ${b.supplierName} | ${money(b.totalAmount, b.currency)} | ${money(b.balance, b.currency)} | ${b.dueAt ? formatDate(b.dueAt) : '—'}${b.pastDue ? ' ⚠ past due' : ''} |`,
  )
  const totals = Object.entries(d.balanceByCurrency)
    .filter(([, amt]) => amt !== 0)
    .map(([cur, amt]) => money(amt, cur === 'UNKNOWN' ? null : cur))
  return [
    `### Vendor bills (AP)${filterSuffix(d.filters)}`,
    countLine(d.rows.length, d.total),
    totals.length > 0
      ? `Open balance across all ${d.total} matches: **${totals.join(' + ')}**${totals.length > 1 ? ' (currencies kept separate)' : ''}${d.totalsTruncated ? ' — partial, too many bills to total' : ''}.`
      : null,
    '',
    '| Bill # | Status | Supplier | Total | Balance | Due |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...tableRows,
    '',
    '*Record payments in [Finance → Bills (AP)](/admin/finance).*',
  ]
    .filter((l) => l != null)
    .join('\n')
}

function formatQuotes(page: Filtered<QuoteListRow>): string {
  if (page.rows.length === 0) return `**Quotes${filterSuffix(page.filters)}:** No matching quotes found.`
  const tableRows = page.rows.map(
    (q) =>
      `| **${q.quoteNumber}** | \`${q.status}\` | ${q.customerName ?? '—'} | ${q.lineCount} | ${money(q.quoteTotal)} | ${q.convertedOrderId ? 'Yes' : '—'} | ${formatDate(q.createdAt)} |`,
  )
  return [
    `### Quotes${filterSuffix(page.filters)}`,
    countLine(page.rows.length, page.total),
    '',
    '| Quote # | Status | Customer | Lines | Total | Converted | Created |',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
    ...tableRows,
    '',
    '*Manage and approve quotes in [Quotes](/admin/quotes).*',
  ].join('\n')
}

function formatQuoteDetail(q: QuoteDetail): string {
  const lineRows = q.lines.map(
    (l) => `| ${l.lineNo} | ${l.skuCode ? `\`${l.skuCode}\`` : '—'} | ${l.description} | ${l.qty} | ${money(l.unitPrice)} |`,
  )
  return [
    `### Quote ${q.quoteNumber}`,
    `- **Status:** \`${q.status}\` · **Customer:** ${q.customerName ?? '—'}`,
    `- **Total:** ${money(q.quoteTotal)} · **Created:** ${formatDate(q.createdAt)}`,
    q.convertedOrderId ? `- **Converted to order:** [open order](/admin/orders/${q.convertedOrderId})` : '- **Converted to order:** not converted',
    q.rejectionReason ? `- **Rejection reason:** ${q.rejectionReason}` : null,
    '',
    '| Line | SKU | Description | Qty | Unit price |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...lineRows,
  ]
    .filter((l) => l != null)
    .join('\n')
}

function formatInvoices(result: ToolResult): string {
  const rows = result.data as InvoiceRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Invoices:** No open or historical invoices found.'
  }
  const tableRows = rows.map(
    (inv) =>
      `| **${inv.invoiceNumber}** | \`${inv.status}\` | $${inv.total.toFixed(2)} | ${inv.balance != null ? `$${inv.balance.toFixed(2)}` : '—'} |`,
  )
  return [
    `### Invoices (${rows.length} Found)`,
    '',
    '| Invoice # | Status | Total Amount | Remaining Balance |',
    '| :--- | :--- | :--- | :--- |',
    ...tableRows,
    '',
    '*Review aging buckets and record payments in [Finance & Invoices](/admin/finance).*',
  ].join('\n')
}

function formatLowStock(result: ToolResult): string {
  const rows = result.data as SkuRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Low stock:** No SKUs are currently at or below their reorder threshold.'
  }
  const tableRows = rows.map(
    (s) => `| \`${s.code}\` | **${s.name}** | **${s.available ?? 0}** | ${s.reorderPoint ?? '—'} |`,
  )
  return [
    `### Low Stock Alerts (${rows.length} Items)`,
    '',
    '| SKU Code | Item Name | Available Stock | Reorder Point |',
    '| :--- | :--- | :--- | :--- |',
    ...tableRows,
    '',
    '*Create purchase orders or adjust inventory in [Inventory & SKUs](/admin/inventory).*',
  ].join('\n')
}

function formatCatalog(page: Page<CatalogRow> & { search?: string }): string {
  const subject = page.search ? ` matching “${page.search}”` : ''
  if (page.rows.length === 0) return `**Products${subject}:** No matching products found.`
  const tableRows = page.rows.map(
    (s) =>
      `| \`${s.code}\` | **${s.name}** | ${s.available == null ? 'no stock recorded' : `${s.available} ${s.unit}`} | ${money(s.price)} |`,
  )
  return [
    `### Products${subject}`,
    countLine(page.rows.length, page.total),
    '',
    '| SKU | Product | Available | Price |',
    '| :--- | :--- | :--- | :--- |',
    ...tableRows,
    '',
    '*See full product details in [Inventory](/admin/inventory).*',
  ].join('\n')
}

function formatGlobalSearch(result: ToolResult): string {
  const data = result.data as GlobalSearchData
  const parts: string[] = []

  if (data.orders?.length) {
    const rows = data.orders.map((o) => `| ${formatOrderCode(o.id)} | \`${o.status}\` | ${money(Number(o.totalAmount))} | ${formatDate(o.createdAt)} |`)
    parts.push(['**Orders found:**', '', '| Order | Status | Total | Created |', '| --- | --- | --- | --- |', ...rows].join('\n'))
  }
  if (data.customers?.length) {
    const rows = data.customers.map((c) => `| ${c.name} | ${c.email ?? '—'} |`)
    parts.push(['**Customers found:**', '', '| Name | Email |', '| --- | --- |', ...rows].join('\n'))
  }
  if (data.skus?.length) {
    const rows = data.skus.map((s) => `| \`${s.code}\` | ${s.name} | ${money(s.price == null ? null : Number(s.price))} |`)
    parts.push(['**Products found:**', '', '| SKU | Name | Price |', '| --- | --- | --- |', ...rows].join('\n'))
  }
  if (data.quotes?.length) {
    const rows = data.quotes.map((q) => `| Q-${q.id.slice(-8).toUpperCase()} | \`${q.status}\` |`)
    parts.push(['**Quotes found:**', '', '| Quote | Status |', '| --- | --- |', ...rows].join('\n'))
  }

  if (parts.length === 0) return '**Search:** No matching orders, customers, SKUs, or quotes found.'
  return parts.join('\n\n')
}

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
