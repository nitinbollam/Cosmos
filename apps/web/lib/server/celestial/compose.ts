import type { ToolResult } from './tools'

type WarehouseRow = {
  code: string
  name: string
  address?: string | null
  city?: string | null
  isDefault?: boolean
}

type OrderRow = {
  id: string
  status: string
  total: number
  createdAt: string | Date
  lineCount?: number
}

type InvoiceRow = {
  invoiceNumber: string
  status: string
  total: number
  balance?: number
}

type QuoteRow = {
  id: string
  status: string
  lineCount?: number
}

type SkuRow = {
  code: string
  name: string
  available?: number
  price?: number
  reorderPoint?: number
}

type GlobalSearchData = {
  orders?: OrderRow[]
  customers?: Array<{ id: string; name: string; email?: string | null }>
  skus?: SkuRow[]
  quotes?: QuoteRow[]
}

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

export function toolResultHasData(result: ToolResult): boolean {
  if (result.error) return false
  if (result.name === 'global_search') {
    const data = result.data as { orders?: unknown[]; customers?: unknown[]; skus?: unknown[]; quotes?: unknown[] }
    return (
      (data?.orders?.length ?? 0) > 0 ||
      (data?.customers?.length ?? 0) > 0 ||
      (data?.skus?.length ?? 0) > 0 ||
      (data?.quotes?.length ?? 0) > 0
    )
  }
  if (result.name === 'get_order_detail') {
    return result.data != null && typeof result.data === 'object'
  }
  if (Array.isArray(result.data)) return result.data.length > 0
  return false
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
      `I'm **Celestial**, your Cosmos assistant.`,
      '',
      plainLanguage
        ? 'I can explain how Cosmos helps you sell, ship, and get paid — or look up your orders, stock, and invoices.'
        : 'I can help with **orders**, **inventory**, **warehouses**, **finance**, **POS**, **quotes**, and how Cosmos features work.',
      '',
      `You asked: "${message}"`,
      '',
      plainLanguage
        ? 'Try: "How does Cosmos work?", "Any orders waiting to ship?", or "What\'s low on stock?"'
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
      ? 'Here’s a simple explanation based on how Cosmos is set up for your business:'
      : 'Here is what Cosmos documentation says about your question:',
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

function formatToolSection(result: ToolResult): string | null {
  switch (result.name) {
    case 'list_warehouses':
      return formatWarehouses(result)
    case 'get_my_orders':
      return formatOrders(result)
    case 'get_order_detail':
      return formatOrderDetail(result)
    case 'list_my_invoices':
      return formatInvoices(result)
    case 'list_my_quotes':
      return formatQuotes(result)
    case 'list_low_stock':
      return formatLowStock(result)
    case 'search_catalog':
      return formatCatalog(result)
    case 'global_search':
      return formatGlobalSearch(result)
    default:
      return null
  }
}

function formatWarehouses(result: ToolResult): string {
  const rows = result.data as WarehouseRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Warehouses:** No active warehouses found in Cosmos.'
  }
  const tableRows = rows.map(
    (w) => `| \`${w.code}\` | ${w.name} | ${w.address ?? w.city ?? '—'} | ${w.isDefault ? '**Yes**' : '—'} |`,
  )
  const manageHref = result.links.find((l) => /warehouse|settings/i.test(l.href))?.href
  return [
    `**Warehouses** — ${rows.length} active:`,
    '',
    '| Code | Name | Address | Default |',
    '| --- | --- | --- | --- |',
    ...tableRows,
    '',
    manageHref ? `Manage in [warehouse settings](${manageHref}).` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function formatOrders(result: ToolResult): string {
  const rows = result.data as OrderRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Orders:** No matching orders found in Cosmos.'
  }
  const listPath = result.links[0]?.href?.replace(/\/[^/]+$/, '') ?? '/admin/orders'
  const tableRows = rows.map((o) => {
    const shortId = o.id.length > 10 ? `…${o.id.slice(-8)}` : o.id
    const date = formatDate(o.createdAt)
    return `| \`${shortId}\` | ${o.status} | $${o.total.toFixed(2)} | ${date} | ${o.lineCount ?? '—'} |`
  })
  return [
    `**Orders** — ${rows.length} recent:`,
    '',
    '| Order | Status | Total | Created | Lines |',
    '| --- | --- | --- | --- | --- |',
    ...tableRows,
    '',
    `Open [Orders](${listPath}) for full detail.`,
  ].join('\n')
}

function formatOrderDetail(result: ToolResult): string {
  const o = result.data as OrderRow & { amountPaid?: number; lines?: unknown[] }
  if (!o?.id) return '**Order:** Not found.'
  const shortId = o.id.length > 10 ? `…${o.id.slice(-8)}` : o.id
  const detailHref = result.links[0]?.href ?? `/admin/orders/${o.id}`
  return [
    `**Order \`${shortId}\`**`,
    `- Status: **${o.status}**`,
    `- Total: $${Number(o.total).toFixed(2)}`,
    o.amountPaid != null ? `- Paid: $${Number(o.amountPaid).toFixed(2)}` : '',
    `- Lines: ${Array.isArray(o.lines) ? o.lines.length : o.lineCount ?? '—'}`,
    '',
    `View [order detail](${detailHref}).`,
  ]
    .filter(Boolean)
    .join('\n')
}

function formatInvoices(result: ToolResult): string {
  const rows = result.data as InvoiceRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Invoices:** No matching invoices found.'
  }
  const tableRows = rows.map(
    (inv) =>
      `| ${inv.invoiceNumber} | ${inv.status} | $${inv.total.toFixed(2)} | ${inv.balance != null ? `$${inv.balance.toFixed(2)}` : '—'} |`,
  )
  return [
    `**Invoices** — ${rows.length} recent:`,
    '',
    '| Invoice | Status | Total | Balance |',
    '| --- | --- | --- | --- |',
    ...tableRows,
  ].join('\n')
}

function formatQuotes(result: ToolResult): string {
  const rows = result.data as QuoteRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Quotes:** No open quotes found.'
  }
  const tableRows = rows.map((q) => {
    const shortId = q.id.length > 10 ? `…${q.id.slice(-8)}` : q.id
    return `| \`${shortId}\` | ${q.status} | ${q.lineCount ?? '—'} |`
  })
  return [
    `**Quotes** — ${rows.length} recent:`,
    '',
    '| Quote | Status | Lines |',
    '| --- | --- | --- |',
    ...tableRows,
    '',
    'Open [Quotes](/admin/quotes).',
  ].join('\n')
}

function formatLowStock(result: ToolResult): string {
  const rows = result.data as SkuRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Low stock:** No SKUs at or below reorder point.'
  }
  const tableRows = rows.map(
    (s) => `| \`${s.code}\` | ${s.name} | ${s.available ?? 0} | ${s.reorderPoint ?? '—'} |`,
  )
  return [
    `**Low stock SKUs** — ${rows.length}:`,
    '',
    '| SKU | Name | Available | Reorder pt |',
    '| --- | --- | --- | --- |',
    ...tableRows,
    '',
    'Review in [Inventory](/admin/inventory).',
  ].join('\n')
}

function formatCatalog(result: ToolResult): string {
  const rows = result.data as SkuRow[]
  if (!Array.isArray(rows) || rows.length === 0) {
    return '**Catalog:** No in-stock SKUs matched your search.'
  }
  const tableRows = rows.map(
    (s) => `| \`${s.code}\` | ${s.name} | ${s.available ?? '—'} | ${s.price != null ? `$${s.price.toFixed(2)}` : '—'} |`,
  )
  return [
    `**Catalog matches** — ${rows.length}:`,
    '',
    '| SKU | Name | Available | Price |',
    '| --- | --- | --- | --- |',
    ...tableRows,
    '',
    'Browse [Catalog](/catalog).',
  ].join('\n')
}

function formatGlobalSearch(result: ToolResult): string {
  const data = result.data as GlobalSearchData
  const parts: string[] = []

  if (data.orders?.length) {
    parts.push(formatOrders({ ...result, name: 'get_my_orders', data: data.orders }))
  }
  if (data.customers?.length) {
    const rows = data.customers.map((c) => `| ${c.name} | ${c.email ?? '—'} |`)
    parts.push(['**Customers found:**', '', '| Name | Email |', '| --- | --- |', ...rows].join('\n'))
  }
  if (data.skus?.length) {
    parts.push(formatCatalog({ ...result, name: 'search_catalog', data: data.skus }))
  }
  if (data.quotes?.length) {
    parts.push(formatQuotes({ ...result, name: 'list_my_quotes', data: data.quotes }))
  }

  if (parts.length === 0) return '**Search:** No matching orders, customers, SKUs, or quotes found.'
  return parts.join('\n\n')
}

function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
