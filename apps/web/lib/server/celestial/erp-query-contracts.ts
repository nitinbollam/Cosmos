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

/** Orders that haven't shipped yet ("waiting to ship", "open orders"). */
export const OPEN_ORDER_STATUSES: OrderStatusFilter[] = ['PENDING', 'AWAITING_APPROVAL', 'CONFIRMED', 'BACKORDERED', 'PROCESSING', 'PACKED']
/** Purchase orders sent to the supplier and not fully received ("still to receive", "on order"). */
export const OPEN_PO_STATUSES: PoStatusFilter[] = ['SUBMITTED', 'PARTIALLY_RECEIVED']

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
  const quarter = quarterPhrase(lower, now)
  if (quarter) return quarter
  if (/\bthis month\b/.test(lower)) return { from: new Date(Date.UTC(y, m, 1)), to: new Date(Date.UTC(y, m + 1, 1)), label: 'this month' }
  if (/\b(last|previous) month\b/.test(lower)) return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)), label: 'last month' }
  if (/\bthis year\b/.test(lower)) return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)), label: 'this year' }
  if (/\b(last|previous) year\b/.test(lower)) return { from: new Date(Date.UTC(y - 1, 0, 1)), to: new Date(Date.UTC(y, 0, 1)), label: 'last year' }
  return undefined
}

// ── Calendar quarters (UTC) ─────────────────────────────────────────────────

export type Quarter = { year: number; q: 1 | 2 | 3 | 4 }

export function quarterOf(d: Date): Quarter {
  return { year: d.getUTCFullYear(), q: (Math.floor(d.getUTCMonth() / 3) + 1) as Quarter['q'] }
}

export function shiftQuarter(x: Quarter, by: number): Quarter {
  const idx = x.year * 4 + (x.q - 1) + by
  return { year: Math.floor(idx / 4), q: ((idx % 4) + 1) as Quarter['q'] }
}

export function quarterLabel(x: Quarter): string {
  return `Q${x.q} ${x.year}`
}

export function quarterRange(x: Quarter): DateRange {
  const from = new Date(Date.UTC(x.year, (x.q - 1) * 3, 1))
  const to = new Date(Date.UTC(x.year, x.q * 3, 1))
  return { from, to, label: quarterLabel(x) }
}

function quarterPhrase(lower: string, now: Date): DateRange | undefined {
  const current = quarterOf(now)
  if (/\bthis quarter\b|\bcurrent quarter\b|\bquarter to date\b|\bqtd\b/.test(lower)) return quarterRange(current)
  if (/\b(last|previous|prior) quarter\b/.test(lower)) return quarterRange(shiftQuarter(current, -1))
  if (/\bnext quarter\b/.test(lower)) return quarterRange(shiftQuarter(current, 1))
  const m = lower.match(/\bq([1-4])(?:\s*(\d{4}))?\b/)
  if (m) return quarterRange({ year: m[2] ? Number(m[2]) : current.year, q: Number(m[1]) as Quarter['q'] })
  return undefined
}

// ── Sales ───────────────────────────────────────────────────────────────────

/** Orders that never became a sale are left out of sales totals. */
export const SALES_EXCLUDED_STATUSES: OrderStatusFilter[] = ['CANCELLED', 'FAILED', 'RETURNED']

/** Full quarters of history required before a forecast is given. */
export const FORECAST_MIN_QUARTERS = 3

export type SalesPeriod = { label: string; from: Date; to: Date; orders: number; revenue: number }

export type SalesForecast =
  | { estimate: { revenue: number; orders: number }; method: string; basis: SalesPeriod[] }
  | { estimate: null; reason: string; basis: SalesPeriod[] }

/**
 * Simple, explainable projection: the average of the most recent FORECAST_MIN_QUARTERS full quarters.
 * Quarters before the tenant's first sale don't count as history (they're empty because the business
 * wasn't on Pleros yet, not because nothing sold), so a young tenant gets "not enough history".
 */
export function forecastFromQuarters(fullQuarters: SalesPeriod[], firstSaleAt: Date | null): SalesForecast {
  const history = firstSaleAt ? fullQuarters.filter((p) => p.from >= quarterRange(quarterOf(firstSaleAt)).from) : []
  if (history.length < FORECAST_MIN_QUARTERS) {
    return {
      estimate: null,
      reason: firstSaleAt
        ? `Not enough history: a forecast needs ${FORECAST_MIN_QUARTERS} full quarters of sales, and sales here start in ${quarterLabel(quarterOf(firstSaleAt))} (${history.length} full quarter${history.length === 1 ? '' : 's'} so far).`
        : 'Not enough history: there are no sales recorded yet.',
      basis: history,
    }
  }
  const basis = history.slice(-FORECAST_MIN_QUARTERS)
  const revenue = roundMoney(basis.reduce((a, p) => a + p.revenue, 0) / basis.length)
  const orders = Math.round(basis.reduce((a, p) => a + p.orders, 0) / basis.length)
  return {
    estimate: { revenue, orders },
    method: `average of the last ${basis.length} full quarters (${basis.map((p) => p.label).join(', ')})`,
    basis,
  }
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
  'least', 'lowest', 'fewest', 'smallest', 'minimum', 'min', 'most', 'highest', 'largest', 'biggest', 'maximum',
  'max', 'top', 'bottom', 'rank', 'ranked', 'ranking', 'sorted', 'sort', 'order', 'by', 'one', 'ones',
  'sales', 'sale', 'sold', 'selling', 'seller', 'sellers', 'revenue', 'best', 'worst', 'performing',
  'performer', 'performers', 'popular',
  // Period words belong to the date filter, not the product name.
  'this', 'last', 'next', 'previous', 'past', 'so', 'far', 'today', 'yesterday', 'day', 'days', 'week', 'weeks',
  'month', 'months', 'quarter', 'quarters', 'year', 'years', 'q1', 'q2', 'q3', 'q4', 'ytd', 'qtd',
  // Question and filler words.
  'who', 'whom', 'whose', 'when', 'why', 'was', 'were', 'will', 'did', 'does', 'been', 'being', 'it', 'its',
  'this', 'these', 'those', 'them', 'they', 'their', 'there', 'here', 'about', 'tell', 'know', 'want', 'need',
  'still', 'yet', 'now', 'any', 'anything', 'something', 'else', 'also', 'again', 'more',
])

/**
 * How many ranked results the question wants: "top 5 products" → 5, "which product has the most
 * stock" / "what is my best seller" / "just the top one" → 1. Plural questions ("top sellers",
 * "which products…") get the normal list (undefined).
 */
export function answerLimit(message: string): number | undefined {
  const lower = message.toLowerCase()
  const n = lower.match(/\b(?:top|bottom|best|worst|first|last)\s+(\d{1,2})\b/)
  if (n) return Math.min(10, Math.max(1, Number(n[1])))
  if (/\bnot the (whole |full )?(list|table|ranking)\b|\b(just|only) the (top|bottom|best|worst|one|answer|winner)\b|\bsingle\b/.test(lower)) return 1
  const superlative = /\b(most|least|best|worst|top|highest|lowest|fewest|biggest|smallest|cheapest|priciest|dearest)\b/.test(lower)
  const plural = /\b(products|items|skus|sellers|ones|stocks|lines|goods|things|list|ranking)\b/.test(lower)
  return superlative && !plural ? 1 : undefined
}

/** "the latest order", "my last quote", "oldest open PO" → 1 record; plural nouns keep the list. */
export function singleRecordWanted(message: string, noun: RegExp): boolean {
  const lower = message.toLowerCase()
  const m = lower.match(/\b(latest|newest|most recent|last|oldest|first|earliest|biggest|largest|smallest)\b(.{0,30})/)
  return Boolean(m && noun.test(m[2]) && !/\b\w+s\b/.test(m[2].match(noun)?.[0] ?? ''))
}

/** "cheapest" → asc, "most expensive" / "priciest" → desc. */
export function priceRankOf(message: string): SortDirection | undefined {
  const lower = message.toLowerCase()
  if (/\b(cheapest|least expensive|lowest.?price[ds]?|lowest cost)\b/.test(lower)) return 'asc'
  if (/\b(most expensive|priciest|highest.?price[ds]?|dearest)\b/.test(lower)) return 'desc'
  return undefined
}

/** Best / top / most → highest first; worst / least / lowest → lowest first. Defaults to highest. */
export function salesRankOf(message: string): SortDirection {
  const lower = message.toLowerCase()
  if (/\b(least|lowest|fewest|worst|bottom|slowest|minimum)\b/.test(lower)) return 'asc'
  return 'desc'
}

/** "least / lowest / fewest" → ascending, "most / highest / largest" → descending, else none. */
export function stockRankOf(message: string): SortDirection | undefined {
  const lower = message.toLowerCase()
  if (/\b(least|lowest|fewest|smallest|minimum|bottom)\b/.test(lower)) return 'asc'
  if (/\b(most|highest|largest|biggest|maximum|top)\b/.test(lower)) return 'desc'
  return undefined
}

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
    .filter((t) => t.length >= 2 && !PRODUCT_STOPWORDS.has(t) && !/^\d{1,4}$/.test(t))
    .slice(0, 4)
}

/** Singular form of a search word so "drinks" finds "Energy Drink Case" and "pens" finds "Pen Pack". */
export function singularWord(term: string): string {
  if (term.includes(' ') || term.length <= 3) return term
  const lower = term.toLowerCase()
  if (lower.endsWith('ies')) return term.slice(0, -3) + 'y'
  if (/(ses|xes|ches|shes|zes)$/.test(lower)) return term.slice(0, -2)
  if (lower.endsWith('s') && !lower.endsWith('ss')) return term.slice(0, -1)
  return term
}

/** Case variants so a `contains` filter matches on both SQLite and case-sensitive Postgres. */
export function caseVariants(term: string): string[] {
  const lower = term.toLowerCase()
  const title = lower.replace(/\b\w/g, (c) => c.toUpperCase())
  return [...new Set([term, lower, term.toUpperCase(), title])]
}
