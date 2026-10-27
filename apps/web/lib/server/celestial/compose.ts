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
  SalesSummary,
  SalesForecastResult,
  ProductSales,
  CustomerSalesRow,
  SupplierRow,
  WarehouseStockRow,
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
type StockData = {
  warehouse?: string
  rows: StockRow[]
  totalRows: number
  skuSummaries: StockSummary[]
  matchedSkus: number
  search?: string
  rank?: 'asc' | 'desc'
  noStockRecorded?: number
  rankTruncated?: boolean
  limit?: number
}
type BillsData = Filtered<BillRow> & { balanceByCurrency: Record<string, number>; totalsTruncated: boolean }

function formatToolSection(result: ToolResult): string | null {
  if (result.notice) return result.notice
  const body = formatToolBody(result)
  // A record picked from a list ("the biggest order") says how it was picked.
  const selection = (result.data as { selection?: unknown } | null)?.selection
  return body && typeof selection === 'string' ? `**${selection}**\n\n${body}` : body
}

function formatToolBody(result: ToolResult): string | null {
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
    case 'sales.summary':
      return formatSalesSummary(result.data as SalesSummary)
    case 'sales.forecast':
      return formatSalesForecast(result.data as SalesForecastResult)
    case 'sales.by_product':
      return formatProductSales(result.data as ProductSales & { search?: string; limit?: number })
    case 'list_my_invoices':
      return formatInvoices(result)
    case 'list_low_stock':
      return formatLowStock(result)
    case 'search_catalog':
      return formatCatalog(result.data as CatalogData)
    case 'sales.by_customer':
      return formatCustomerSales(result.data as CustomerSalesData)
    case 'purchasing.suppliers':
      return formatSuppliers(result.data as { rows: SupplierRow[]; total: number })
    case 'inventory.by_warehouse':
      return formatWarehouseStock(result.data as WarehouseStockData)
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

/** "Showing 9–16 of 23" when the page is a subset of all matches, with a hint when more remain. */
function countLine(page: { rows: unknown[]; total: number; page?: number; pageSize?: number }): string {
  const shown = page.rows.length
  const total = page.total
  if (total <= shown && (page.page ?? 1) === 1) return `${total} ${total === 1 ? 'match' : 'matches'}.`
  const start = ((page.page ?? 1) - 1) * (page.pageSize ?? shown) + 1
  const end = start + shown - 1
  const more = end < total ? ' Say “show more” for the next page.' : ''
  return `Showing ${start}–${end} of ${total} matches.${more}`
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
    countLine(page),
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
    '',
    ...shipments,
    '',
    `*Open [${code}](/admin/orders/${o.id}) for the full timeline and invoice.*`,
  ].join('\n')
}

function formatStock(d: StockData): string {
  const subject = d.search ? `matching “${d.search}”` : ''
  if (d.matchedSkus === 0) {
    return d.search
      ? `**Stock:** I couldn’t find a product whose name or SKU matches “${d.search}”. This is a name search, not a stock check — try another word from the product name.`
      : '**Stock:** no products found.'
  }
  if (d.rank) return formatStockRanking(d, subject)
  if (d.rows.length === 0) {
    return d.warehouse
      ? `**Stock in ${d.warehouse}:** nothing is recorded there${subject ? ` ${subject}` : ''} — no stock levels exist for ${d.matchedSkus} matching product(s) in that warehouse.`
      : `**Stock:** ${d.matchedSkus} product(s) ${subject} found, but no stock is recorded in any warehouse.`
  }
  const tableRows = d.rows.map(
    (r) =>
      `| \`${r.code}\` | ${r.name} | ${r.warehouseName} | **${r.available}** ${r.unit} | ${r.onHand} | ${r.reserved} | ${r.reorderPoint || '—'} |`,
  )
  const summary =
    d.skuSummaries.length > 1
      ? ['', '**Total available by SKU:**', ...d.skuSummaries.map((s) => `- \`${s.code}\` ${s.name}: ${s.available} ${s.unit}`)]
      : []
  return [
    d.warehouse ? `### Stock in ${d.warehouse}${subject ? ` ${subject}` : ''}` : `### Stock by warehouse${subject ? ` ${subject}` : ''}`,
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

/** Products ranked by total available across warehouses ("least stock" / "most stock"). */
function ordinalWord(rank: 'asc' | 'desc' | undefined, kind: 'stock' | 'sales'): string {
  if (kind === 'stock') return rank === 'asc' ? 'Least stock' : 'Most stock'
  return rank === 'asc' ? 'Lowest seller' : 'Best seller'
}

function formatStockRanking(d: StockData, subject: string): string {
  const order = d.rank === 'asc' ? 'lowest' : 'highest'
  if (d.skuSummaries.length === 0) {
    return `**Stock${subject ? ` ${subject}` : ''}:** none of the ${d.matchedSkus} product(s) have stock recorded in any warehouse.`
  }
  const ranked = d.matchedSkus - (d.noStockRecorded ?? 0)
  if (d.limit === 1) {
    const s = d.skuSummaries[0]
    return [
      `**${ordinalWord(d.rank, 'stock')}${subject ? ` (${subject})` : ''}:** **${s.name}** (\`${s.code}\`) — ${s.available} ${s.unit} available across all warehouses (${s.onHand} on hand).`,
      '',
      `*${d.rank === 'asc' ? 'Lowest' : 'Highest'} of ${ranked} product(s) with stock recorded. Ask “show the full ranking” to see the rest.*`,
    ].join('\n')
  }
  const tableRows = d.skuSummaries.map(
    (s, i) => `| ${i + 1} | \`${s.code}\` | ${s.name} | **${s.available}** ${s.unit} | ${s.onHand} |`,
  )
  const notes = [
    d.noStockRecorded ? `${d.noStockRecorded} product(s) have no stock recorded at all and are not ranked.` : null,
    d.rankTruncated ? `Only the first 1,000 of ${d.matchedSkus} matching products were compared; narrow the search for a complete ranking.` : null,
  ].filter((n): n is string => n != null)
  return [
    `### Products by available stock, ${order} first${subject ? ` (${subject})` : ''}`,
    `Total available across all warehouses. Showing ${d.skuSummaries.length} of ${d.matchedSkus - (d.noStockRecorded ?? 0)} ranked product(s).`,
    '',
    '| # | SKU | Product | Available | On hand |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...tableRows,
    ...(notes.length ? ['', ...notes.map((n) => `*${n}*`)] : []),
    '',
    '*Adjust stock or reorder in [Inventory](/admin/inventory).*',
  ].join('\n')
}

function salesBasisNote(excluded: string[]): string {
  return `*Sales = order totals as recorded, excluding ${excluded.map((s) => s.toLowerCase()).join(', ')} orders. Orders store no currency.*`
}

function formatSalesSummary(d: SalesSummary): string {
  if (d.periods.length === 0) return `**Sales — ${d.label}:** that period hasn't started yet, so there are no sales to show.`
  const rows = d.periods.map((p) => `| ${p.label} | ${p.orders} | ${money(p.revenue)} |`)
  return [
    `### Sales — ${d.label}`,
    `Total: **${money(d.totalRevenue)}** from **${d.totalOrders}** order(s)${d.truncated ? ' (partial: too many orders to total)' : ''}.`,
    d.averageOrderValue != null ? `Average order value: **${money(d.averageOrderValue)}**.` : 'Average order value: no orders in this period.',
    '',
    `| ${d.granularity === 'month' ? 'Month' : 'Quarter'} | Orders | Revenue |`,
    '| :--- | :--- | :--- |',
    ...rows,
    '',
    salesBasisNote(d.excludedStatuses),
  ].join('\n')
}

function formatSalesForecast(d: SalesForecastResult): string {
  const current = `${d.currentQuarter.label}: ${money(d.currentQuarter.revenue)} from ${d.currentQuarter.orders} order(s).`
  if (d.estimate == null) {
    return [
      `### Sales forecast — ${d.target}`,
      `**No forecast.** ${d.reason}`,
      '',
      `For reference, ${current}`,
      '',
      salesBasisNote(d.excludedStatuses),
    ].join('\n')
  }
  const rows = d.basis.map((p) => `| ${p.label} | ${p.orders} | ${money(p.revenue)} |`)
  return [
    `### Sales forecast — ${d.target}`,
    `Estimated revenue: **${money(d.estimate.revenue)}** from about **${d.estimate.orders}** order(s).`,
    `This is a simple estimate (${d.method}), not a guarantee.`,
    '',
    '| Quarter | Orders | Revenue |',
    '| :--- | :--- | :--- |',
    ...rows,
    '',
    `For comparison, ${current}`,
    '',
    salesBasisNote(d.excludedStatuses),
  ].join('\n')
}

function formatProductSales(d: ProductSales & { search?: string; limit?: number }): string {
  const subject = d.search ? ` matching “${d.search}”` : ''
  if (d.rows.length === 0) return `**Sales by product${subject} — ${d.label}:** no products sold in this period.`
  if (d.limit === 1) {
    const r = d.rows[0]
    return [
      `**${ordinalWord(d.rank, 'sales')}${subject} — ${d.label}:** **${r.name}** (\`${r.code}\`) — ${r.units} ${r.unit} sold, ${money(r.revenue)} revenue.`,
      '',
      `*${d.rank === 'asc' ? 'Lowest' : 'Highest'} of ${d.ranked} product(s) by revenue. Ask “show the full ranking” to see the rest.*`,
    ].join('\n')
  }
  const rows = d.rows.map((r, i) => `| ${i + 1} | \`${r.code}\` | ${r.name} | ${r.units} ${r.unit} | ${money(r.revenue)} |`)
  return [
    `### Products by sales${subject}, ${d.rank === 'asc' ? 'lowest' : 'highest'} first — ${d.label}`,
    `${d.limit ? `Top ${d.rows.length}` : `Showing ${d.rows.length}`} of ${d.ranked} product(s)${d.truncated ? ' (partial: too many order lines to total)' : ''}.`,
    '',
    '| # | SKU | Product | Units sold | Revenue |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...rows,
    '',
    `*Revenue = units × unit price on order lines, net of returned units, before tax; excludes ${d.excludedStatuses.map((s) => s.toLowerCase()).join(', ')} orders. Orders store no currency.*`,
  ].join('\n')
}

function formatPurchaseOrders(page: Filtered<PurchaseOrderListRow>): string {
  if (page.rows.length === 0) return `**Purchase orders${filterSuffix(page.filters)}:** No matching purchase orders found.`
  const tableRows = page.rows.map(
    (po) =>
      `| **${po.number}** | \`${po.status}\` | ${po.supplierName} | ${po.qtyReceived}/${po.qtyOrdered} | ${po.goodsCost == null ? `unknown (${po.missingCostLines} line(s) without cost)` : money(po.goodsCost, po.currency)} | ${formatDate(po.createdAt)} |`,
  )
  return [
    `### Purchase orders${filterSuffix(page.filters)}`,
    countLine(page),
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
    '',
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
    countLine(d),
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
    countLine(page),
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
  const data = result.data as InvoiceRow[] | { rows: InvoiceRow[]; total: number; filters?: string[]; outstandingOnly?: boolean }
  const rows = Array.isArray(data) ? data : data.rows
  const filters = Array.isArray(data) ? [] : (data.filters ?? [])
  if (rows.length === 0) {
    if (!Array.isArray(data) && data.outstandingOnly) return `**Invoices${filterSuffix(filters)}:** none — every matching invoice is fully paid.`
    return `**Invoices${filterSuffix(filters)}:** no invoices found.`
  }
  const total = Array.isArray(data) ? rows.length : data.total
  const owed = rows.reduce((a, r) => a + (Number(r.balance) || 0), 0)
  const tableRows = rows.map(
    (inv) =>
      `| **${inv.invoiceNumber}** | \`${inv.status}\` | $${inv.total.toFixed(2)} | ${inv.balance != null ? `$${inv.balance.toFixed(2)}` : '—'} |`,
  )
  return [
    `### Invoices${filterSuffix(filters)}`,
    `${total > rows.length ? `Showing ${rows.length} of ${total}` : `${total} invoice(s)`}; remaining balance on these: **${money(owed, 'USD')}**.`,
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

type CatalogData = Page<CatalogRow> & { search?: string; priceRank?: 'asc' | 'desc'; limit?: number }
type CustomerSalesData = {
  label: string
  rank: 'asc' | 'desc'
  rows: CustomerSalesRow[]
  ranked: number
  excludedStatuses: string[]
  limit?: number
}
type WarehouseStockData = { rows: WarehouseStockRow[]; units: string[]; rank: 'asc' | 'desc'; limit?: number; warehouses: number }

function formatCustomerSales(d: CustomerSalesData): string {
  if (d.rows.length === 0) return `**Customers by sales — ${d.label}:** no sales in this period.`
  const basis = `*Revenue = order totals, excluding ${d.excludedStatuses.map((x) => x.toLowerCase()).join(', ')} orders. Orders store no currency.*`
  if (d.limit === 1) {
    const r = d.rows[0]
    return [
      `**${d.rank === 'asc' ? 'Smallest customer' : 'Top customer'} — ${d.label}:** **${r.name}** — ${money(r.revenue)} from ${r.orders} order(s).`,
      '',
      `*${d.rank === 'asc' ? 'Lowest' : 'Highest'} of ${d.ranked} customer(s) with orders.* ${basis}`,
    ].join('\n')
  }
  return [
    `### Customers by sales, ${d.rank === 'asc' ? 'lowest' : 'highest'} first — ${d.label}`,
    `Showing ${d.rows.length} of ${d.ranked} customer(s).`,
    '',
    '| # | Customer | Orders | Revenue |',
    '| :--- | :--- | :--- | :--- |',
    ...d.rows.map((r, i) => `| ${i + 1} | ${r.name} | ${r.orders} | ${money(r.revenue)} |`),
    '',
    basis,
  ].join('\n')
}

function formatSuppliers(d: { rows: SupplierRow[]; total: number }): string {
  if (d.rows.length === 0) return '**Suppliers:** none set up yet.'
  const owed = (r: SupplierRow) => {
    const parts = Object.entries(r.openBalanceByCurrency).filter(([, v]) => v !== 0)
    return parts.length ? parts.map(([c, v]) => money(v, c === 'UNKNOWN' ? null : c)).join(' + ') : '—'
  }
  return [
    `### Suppliers`,
    d.total > d.rows.length ? `Showing ${d.rows.length} of ${d.total}.` : `${d.total} supplier(s).`,
    '',
    '| Supplier | Code | Email | Phone | Purchase orders (open) | Owed on bills |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ...d.rows.map((r) => `| **${r.name}** | \`${r.code}\` | ${r.email ?? '—'} | ${r.phone ?? '—'} | ${r.purchaseOrders} (${r.openPurchaseOrders}) | ${owed(r)} |`),
    '',
    '*Manage suppliers in [Purchasing](/admin/purchasing).*',
  ].join('\n')
}

function formatWarehouseStock(d: WarehouseStockData): string {
  if (d.rows.length === 0) return '**Stock per warehouse:** no active warehouses.'
  const unitsNote = d.units.length > 1 ? ` Units are summed across ${d.units.join(', ')}.` : ''
  if (d.limit === 1) {
    const r = d.rows[0]
    return [
      `**${d.rank === 'asc' ? 'Least stock' : 'Most stock'}:** **${r.name}** (\`${r.code}\`) — ${r.available} units available across ${r.skus} product(s) (${r.onHand} on hand).`,
      '',
      `*${d.rank === 'asc' ? 'Lowest' : 'Highest'} of ${d.warehouses} warehouse(s).${unitsNote}*`,
    ].join('\n')
  }
  return [
    `### Stock per warehouse, ${d.rank === 'asc' ? 'lowest' : 'highest'} first`,
    '',
    '| Warehouse | Code | Products in stock | Available | On hand |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...d.rows.map((r) => `| **${r.name}** | \`${r.code}\` | ${r.skus} | ${r.available} | ${r.onHand} |`),
    unitsNote ? `\n*${unitsNote.trim()}*` : '',
  ].join('\n')
}

function formatCatalog(page: CatalogData): string {
  const subject = page.search ? ` matching “${page.search}”` : ''
  if (page.rows.length === 0) {
    return page.search
      ? `**Products:** I couldn’t find a product whose name or SKU matches “${page.search}”. Try another word from the product name.`
      : '**Products:** none found.'
  }
  if (page.priceRank && page.limit === 1) {
    const s = page.rows[0]
    return [
      `**${page.priceRank === 'asc' ? 'Cheapest' : 'Most expensive'} product${subject}:** **${s.name}** (\`${s.code}\`) — ${money(s.price)} each, ${s.available == null ? 'no stock recorded' : `${s.available} ${s.unit} available`}.`,
      '',
      `*${page.priceRank === 'asc' ? 'Lowest' : 'Highest'} list price of ${page.total} active product(s).*`,
    ].join('\n')
  }
  if (page.priceRank) {
    return [
      `### Products by price, ${page.priceRank === 'asc' ? 'cheapest' : 'most expensive'} first${subject}`,
      `Showing ${page.rows.length} of ${page.total}.`,
      '',
      '| SKU | Product | Price | Available |',
      '| :--- | :--- | :--- | :--- |',
      ...page.rows.map((s) => `| \`${s.code}\` | **${s.name}** | ${money(s.price)} | ${s.available == null ? 'no stock recorded' : `${s.available} ${s.unit}`} |`),
    ].join('\n')
  }
  const tableRows = page.rows.map(
    (s) =>
      `| \`${s.code}\` | **${s.name}** | ${s.available == null ? 'no stock recorded' : `${s.available} ${s.unit}`} | ${money(s.price)} |`,
  )
  return [
    `### Products${subject}`,
    countLine(page),
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
