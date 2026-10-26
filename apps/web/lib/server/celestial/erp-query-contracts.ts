/**
 * Pure contracts for Celestial's read-only ERP tools: closed filter vocabularies, date-range and
 * reference parsing, and the evidence rules (nullable costs, currency-separated totals) the
 * queries and composer share. Nothing here touches a database.
 */

/** Rows returned per page for list tools; all-match totals are always reported alongside. */
export const PAGE_SIZE = 8

export const ORDER_STATUSES = [
  'PENDING',
  'AWAITING_APPROVAL',
  'CONFIRMED',
  'BACKORDERED',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
  'RETURNED',
] as const
export type OrderStatusFilter = (typeof ORDER_STATUSES)[number]

export const ORDER_CHANNELS = ['POS', 'B2B_PORTAL', 'SALES_REP', 'API', 'EDI', 'SHOPIFY', 'EBAY', 'WALMART', 'AMAZON'] as const
export type OrderChannelFilter = (typeof ORDER_CHANNELS)[number]

export const ORDER_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
export type OrderPriorityFilter = (typeof ORDER_PRIORITIES)[number]

export const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'CLOSED', 'CANCELLED'] as const
export type PoStatusFilter = (typeof PO_STATUSES)[number]

export const BILL_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const
export type BillStatusFilter = (typeof BILL_STATUSES)[number]
/** Bill statuses that still carry a payable balance. */
export const OUTSTANDING_BILL_STATUSES: BillStatusFilter[] = ['ISSUED', 'PARTIALLY_PAID']

export const QUOTE_STATUSES = ['OPEN', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUBMITTED', 'EXPIRED'] as const
export type QuoteStatusFilter = (typeof QUOTE_STATUSES)[number]

export type SortDirection = 'asc' | 'desc'

/** A half-open UTC range [from, to). */
export type DateRange = { from: Date; to: Date; label: string }

const DAY_MS = 24 * 60 * 60 * 1000

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Monday-start UTC week containing `d`. */
function startOfUtcWeek(d: Date): Date {
  const day = startOfUtcDay(d)
  const offset = (day.getUTCDay() + 6) % 7
  return new Date(day.getTime() - offset * DAY_MS)
}

/**
 * Resolve a relative calendar phrase to a UTC date range. Returns undefined when the message names
 * no supported period, so callers never filter on a guessed date.
 */
export function resolveDateRange(message: string, now = new Date()): DateRange | undefined {
  const lower = message.toLowerCase()
  const today = startOfUtcDay(now)
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()

  const rolling = lower.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/)
  if (rolling) {
    const n = Number(rolling[1])
    if (n > 0) return { from: new Date(today.getTime() - (n - 1) * DAY_MS), to: new Date(today.getTime() + DAY_MS), label: `last ${n} days` }
  }
  if (/\btoday\b/.test(lower)) return { from: today, to: new Date(today.getTime() + DAY_MS), label: 'today' }
  if (/\byesterday\b/.test(lower)) return { from: new Date(today.getTime() - DAY_MS), to: today, label: 'yesterday' }
  if (/\bthis week\b/.test(lower)) {
    const from = startOfUtcWeek(now)
    return { from, to: new Date(from.getTime() + 7 * DAY_MS), label: 'this week' }
  }
  if (/\b(last|previous) week\b/.test(lower)) {
    const to = startOfUtcWeek(now)
    return { from: new Date(to.getTime() - 7 * DAY_MS), to, label: 'last week' }
  }
  if (/\bthis month\b/.test(lower)) return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)), label: 'this month' }
  if (/\b(last|previous) month\b/.test(lower)) return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)), label: 'last month' }
  if (/\bthis year\b/.test(lower)) return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)), label: 'this year' }
  if (/\b(last|previous) year\b/.test(lower)) return { from: new Date(Date.UTC(y - 1, 0, 1)), to: new Date(Date.UTC(y, 0, 1)), label: 'last year' }
  return undefined
}

/** `ORD-1001`, `order #1001`, `order 1001` → 1001. */
export function parseOrderNumberRef(message: string): number | undefined {
  const m = message.match(/\bORD-(\d+)\b/i) ?? message.match(/\border\s*(?:number\s*)?#?\s*(\d{2,})\b/i)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : undefined
}

/** `PO-1001`, `PO 1001`, `PO#1001` → `PO-1001` (the stored number format). */
export function parsePoRef(message: string): string | undefined {
  const m = message.match(/\bPO[-\s#]*(\d+)\b/i)
  return m ? `PO-${m[1]}` : undefined
}

/** `Q-AB12CD34` → `ab12cd34`, the lowercase id suffix that quote numbers are derived from. */
export function parseQuoteRef(message: string): string | undefined {
  const m = message.match(/\bQ-([A-Z0-9_]{4,})\b/i)
  return m ? m[1].toLowerCase() : undefined
}

/**
 * Goods cost of PO lines. A line with no recorded unit cost makes the total unknown rather than
 * silently counting it as zero.
 */
export function goodsCost(lines: Array<{ qty: number; unitCost: number | null }>): {
  amount: number | null
  missingCostLines: number
} {
  let amount = 0
  let missingCostLines = 0
  for (const line of lines) {
    if (line.unitCost == null) missingCostLines += 1
    else amount += line.qty * line.unitCost
  }
  return { amount: missingCostLines > 0 ? null : roundMoney(amount), missingCostLines }
}

/** Sum amounts per currency. Different currencies are never added together. */
export function sumByCurrency(rows: Array<{ currency: string | null | undefined; amount: number }>): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const row of rows) {
    const cur = row.currency?.trim().toUpperCase() || 'UNKNOWN'
    totals[cur] = roundMoney((totals[cur] ?? 0) + row.amount)
  }
  return totals
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

/** Words that describe the kind of lookup rather than the product being looked up. */
const PRODUCT_STOPWORDS = new Set([
  'a', 'an', 'the', 'all', 'any', 'every', 'some', 'our', 'my', 'we', 'us', 'i', 'you', 'do', 'does', 'have', 'has',
  'show', 'list', 'find', 'search', 'lookup', 'look', 'up', 'get', 'give', 'me', 'tell', 'about', 'what', 'which',
  'where', 'how', 'much', 'many', 'is', 'are', 'there', 'for', 'of', 'in', 'on', 'at', 'with', 'by', 'to', 'and',
  'or', 'containing', 'contains', 'contain', 'named', 'called', 'matching', 'like', 'that', 'whose', 'name', 'names',
  'product', 'products', 'item', 'items', 'sku', 'skus', 'catalog', 'stock', 'stocks', 'inventory', 'level',
  'levels', 'available', 'availability', 'on-hand', 'hand', 'onhand', 'reserved', 'quantity', 'quantities', 'qty',
  'left', 'remaining', 'each', 'every', 'warehouse', 'warehouses', 'per', 'grouped', 'group', 'unit', 'units',
  'currently', 'right', 'now', 'please', 'can', 'could', 'would', 'buy', 'reorder', 'point',
])

/**
 * Pull the product words out of a question: "cable product" and "all products containing cable"
 * both resolve to ["cable"]. Quoted text wins verbatim. Returns [] when nothing specific is named.
 */
export function productSearchTokens(message: string): string[] {
  const quoted = message.match(/"([^"]+)"/)?.[1]?.trim()
  if (quoted) return [quoted]
  return message
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !PRODUCT_STOPWORDS.has(t))
    .slice(0, 4)
}

/** Case variants so a `contains` filter matches on both SQLite and case-sensitive Postgres. */
export function caseVariants(term: string): string[] {
  const lower = term.toLowerCase()
  const title = lower.replace(/\b\w/g, (c) => c.toUpperCase())
  return [...new Set([term, lower, term.toUpperCase(), title])]
}
