import {
  parseOrderNumberRef,
  parsePoRef,
  parseQuoteRef,
  productSearchTokens,
  resolveDateRange,
  type BillStatusFilter,
  type DateRange,
  type OrderChannelFilter,
  type OrderPriorityFilter,
  type OrderStatusFilter,
  type PoStatusFilter,
  type QuoteStatusFilter,
  type SortDirection,
} from './erp-query-contracts'

export type CelestialToolName =
  | 'orders.list'
  | 'orders.detail'
  | 'inventory.stock'
  | 'purchasing.orders'
  | 'purchasing.order_detail'
  | 'finance.bills'
  | 'quotes.list'
  | 'quotes.detail'
  | 'list_my_invoices'
  | 'search_catalog'
  | 'global_search'
  | 'list_low_stock'
  | 'list_warehouses'

/** Validated parameters the tools may use. Every field is optional; tools ignore what they don't need. */
export type ToolParams = {
  orderId?: string
  orderNumber?: number
  quoteId?: string
  quoteRef?: string
  poRef?: string
  /** Product words for SKU lookups ("cable product" → ["cable"]). */
  searchTokens?: string[]
  /** Free-text term for global search. */
  searchTerm?: string
  orderStatus?: OrderStatusFilter
  channel?: OrderChannelFilter
  priority?: OrderPriorityFilter
  dateRange?: DateRange
  sort?: SortDirection
  poStatus?: PoStatusFilter
  billStatus?: BillStatusFilter
  outstanding?: boolean
  pastDue?: boolean
  supplier?: string
  quoteStatus?: QuoteStatusFilter
  /** 1-based page for list tools ("show more"). */
  page?: number
}

export type DetectedIntent = ToolParams & { tools: CelestialToolName[] }

const ORDER_ID = /\b(seed_ord_[a-z0-9_]+|[a-z0-9]{20,})\b/i
const DATA_NOUNS =
  /\b(order|orders|invoice|invoices|warehouse|warehouses|stock|sku|skus|quote|quotes|customer|customers|bill|bills|purchase|supplier|suppliers|vendor|vendors|product|products|inventory)\b/

/** General overview / how-it-works questions — prefer plain business language, not dev docs. */
export function isPlainLanguagePreferred(message: string): boolean {
  const lower = message.toLowerCase().trim()
  if (isHowToQuestion(message)) return true
  if (/\b(what is|tell me about|explain|describe|overview of)\b/.test(lower) && /\bpleros\b/.test(lower)) {
    return true
  }
  if (/\bhow\b[\s\S]{0,30}\bpleros\b/.test(lower)) return true
  if (/\bwhat can pleros do\b/.test(lower)) return true
  return false
}

export function isHowToQuestion(message: string): boolean {
  const lower = message.toLowerCase()
  if (/\bhow many\b/.test(lower) || /\bhow much\b/.test(lower)) return false
  if (/\b(show|list|find|search|any|pending|open|recent|which|compare)\b/.test(lower) && DATA_NOUNS.test(lower)) {
    return false
  }
  if (/\bwhat (are|is)\b/.test(lower) && DATA_NOUNS.test(lower)) return false
  return (
    /\b(how does|how do|how to|how is|how are|explain|walk me through|tell me about)\b/.test(lower) ||
    /\bhow\b[\s\S]{0,40}\b(work|works)\b/.test(lower)
  )
}

function detectOrderStatus(lower: string): OrderStatusFilter | undefined {
  if (/\bawaiting approval\b|\bneeds? approval\b/.test(lower)) return 'AWAITING_APPROVAL'
  if (/\bback.?order(ed|s)?\b/.test(lower)) return 'BACKORDERED'
  if (/\b(pending|awaiting)\b/.test(lower)) return 'PENDING'
  if (/\bconfirmed\b/.test(lower)) return 'CONFIRMED'
  if (/\b(processing|in progress|being picked)\b/.test(lower)) return 'PROCESSING'
  if (/\b(packed|ready to ship)\b/.test(lower)) return 'PACKED'
  if (/\b(shipped|in transit)\b/.test(lower)) return 'SHIPPED'
  if (/\b(delivered|completed)\b/.test(lower)) return 'DELIVERED'
  if (/\b(cancelled|canceled)\b/.test(lower)) return 'CANCELLED'
  if (/\bfailed\b/.test(lower)) return 'FAILED'
  if (/\breturn(ed|s)?\b/.test(lower)) return 'RETURNED'
  return undefined
}

function detectChannel(lower: string): OrderChannelFilter | undefined {
  if (/\bpos\b|\bpoint of sale\b|\bin.?store\b/.test(lower)) return 'POS'
  if (/\bb2b\b|\bportal\b/.test(lower)) return 'B2B_PORTAL'
  if (/\bsales rep\b/.test(lower)) return 'SALES_REP'
  if (/\bedi\b/.test(lower)) return 'EDI'
  if (/\bapi\b/.test(lower)) return 'API'
  if (/\bshopify\b/.test(lower)) return 'SHOPIFY'
  if (/\bebay\b/.test(lower)) return 'EBAY'
  if (/\bwalmart\b/.test(lower)) return 'WALMART'
  if (/\bamazon\b/.test(lower)) return 'AMAZON'
  return undefined
}

function detectPriority(lower: string): OrderPriorityFilter | undefined {
  if (/\burgent\b/.test(lower)) return 'URGENT'
  if (/\bhigh.?priority\b/.test(lower)) return 'HIGH'
  if (/\blow.?priority\b/.test(lower)) return 'LOW'
  return undefined
}

function detectPoStatus(lower: string): PoStatusFilter | undefined {
  if (/\bpartially received\b|\bpartial(ly)? receipt\b/.test(lower)) return 'PARTIALLY_RECEIVED'
  if (/\b(pending approval|awaiting approval)\b/.test(lower)) return 'PENDING_APPROVAL'
  if (/\bdrafts?\b/.test(lower)) return 'DRAFT'
  if (/\bsubmitted\b/.test(lower)) return 'SUBMITTED'
  if (/\b(closed|fully received)\b/.test(lower)) return 'CLOSED'
  if (/\b(cancelled|canceled)\b/.test(lower)) return 'CANCELLED'
  return undefined
}

function detectQuoteStatus(lower: string): QuoteStatusFilter | undefined {
  if (/\b(pending approval|awaiting approval)\b/.test(lower)) return 'PENDING_APPROVAL'
  if (/\bapproved\b/.test(lower)) return 'APPROVED'
  if (/\brejected\b/.test(lower)) return 'REJECTED'
  if (/\bsubmitted\b/.test(lower)) return 'SUBMITTED'
  if (/\bexpired\b/.test(lower)) return 'EXPIRED'
  if (/\bopen\b/.test(lower)) return 'OPEN'
  return undefined
}

const MONTHS = /^(january|february|march|april|may|june|july|august|september|october|november|december)\b/i

/** Capitalised name after "from/for/supplier/vendor", e.g. "bills from Acme Supply". */
function detectSupplier(message: string): string | undefined {
  const m = message.match(/\b(?:from|for|supplier|vendor)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3})/)
  const name = m?.[1]?.trim()
  if (!name || /^(PO|ORD|Q)-?\d*$/i.test(name) || MONTHS.test(name)) return undefined
  return name
}

/** "how much do we owe Pacific Supply" → "Pacific Supply". */
function supplierAfterOwe(message: string): string | undefined {
  const name = message.match(/\bowe\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3})/)?.[1]?.trim()
  return name && !MONTHS.test(name) ? name : undefined
}

export function detectIntent(message: string, isBuyer: boolean, context?: { orderId?: string; quoteId?: string }): DetectedIntent {
  const lower = message.toLowerCase()
  const tools = new Set<CelestialToolName>()
  const out: DetectedIntent = { tools: [], orderId: context?.orderId, quoteId: context?.quoteId }

  if (isHowToQuestion(message)) return out

  out.dateRange = resolveDateRange(message)
  if (/\boldest\b|\bearliest\b/.test(lower)) out.sort = 'asc'
  else if (/\bnewest\b|\blatest\b|\bmost recent\b/.test(lower)) out.sort = 'desc'

  // Purchasing first, so "purchase order" never reads as a sales order.
  const poRef = parsePoRef(message)
  const mentionsPurchasing =
    Boolean(poRef) ||
    /\bpurchase orders?\b|\bprocurement\b|\bsupplier orders?\b/.test(lower) ||
    /\bPOs?\b/.test(message)
  const salesText = lower.replace(/\bpurchase orders?\b/g, ' ').replace(/\bsupplier orders?\b/g, ' ')

  if (mentionsPurchasing) {
    if (poRef) {
      out.poRef = poRef
      tools.add('purchasing.order_detail')
    } else {
      tools.add('purchasing.orders')
      out.poStatus = detectPoStatus(lower)
    }
    out.supplier = detectSupplier(message)
  }

  // "we owe X" is accounts payable; "X owes us" / "customers owe" is accounts receivable.
  const weOwe = /\b(we|do we|i)\s+(still\s+)?owe\b/.test(lower) || /\bowe\b[\s\S]{0,30}\b(suppliers?|vendors?)\b/.test(lower)
  const mentionsBills = weOwe || /\b(vendor bills?|supplier bills?|bills?|payables?|accounts payable|a\/p)\b/.test(lower)
  if (mentionsBills) {
    tools.add('finance.bills')
    if (/\b(past due|overdue|late)\b/.test(lower)) out.pastDue = true
    if (/\b(unpaid|outstanding|open|owed?|still due)\b/.test(lower)) out.outstanding = true
    else if (/\b(fully paid|settled|paid off|already paid)\b/.test(lower) || /\bpaid bills?\b/.test(lower)) out.outstanding = false
    if (/\bpartially paid\b/.test(lower)) out.billStatus = 'PARTIALLY_PAID'
    else if (/\bvoid(ed)?\b/.test(lower)) out.billStatus = 'VOID'
    else if (/\bdrafts?\b/.test(lower)) out.billStatus = 'DRAFT'
    if (weOwe && out.outstanding === undefined) out.outstanding = true
    out.supplier = out.supplier ?? detectSupplier(message) ?? supplierAfterOwe(message)
  }

  if (
    /\b(invoices?|receivables?|accounts receivable|a\/r|owes)\b/.test(lower) ||
    (!weOwe && /\bowe\b/.test(lower)) ||
    (!mentionsBills && /\b(payment|balance|due)\b/.test(lower))
  ) {
    tools.add('list_my_invoices')
  }

  const orderNumber = parseOrderNumberRef(salesText)
  const idMatch = message.match(ORDER_ID)
  if (idMatch) out.orderId = idMatch[1]
  if (
    /\bORD-\d+\b/i.test(salesText) ||
    /\b(orders?|shipments?|shipped|track|tracking|delivery|fulfillment|back.?orders?|back.?ordered)\b/.test(salesText)
  ) {
    if (orderNumber != null || out.orderId) {
      out.orderNumber = orderNumber
      tools.add('orders.detail')
    } else {
      tools.add('orders.list')
      out.orderStatus = detectOrderStatus(salesText)
      out.channel = detectChannel(salesText)
      out.priority = detectPriority(salesText)
    }
  }

  const quoteRef = parseQuoteRef(message)
  if (quoteRef || out.quoteId) {
    out.quoteRef = quoteRef
    tools.add('quotes.detail')
  } else if (/\b(quotes?|quotations?|counter.?offers?)\b/.test(lower)) {
    tools.add('quotes.list')
    out.quoteStatus = detectQuoteStatus(lower)
  }

  const lowStock = !isBuyer && /\b(low stock|low on stock|running low|below reorder|reorder point|out of stock)\b/.test(lower)
  const stockWords = /\b(stock|on.?hand|available|availability|inventory|reserved|in each warehouse|by warehouse|per warehouse|how many units)\b/.test(lower)
  const productWords = /\b(catalog|sku|skus|products?|items?)\b/.test(lower)
  if (lowStock) {
    tools.add('list_low_stock')
  } else if (stockWords && !isBuyer) {
    out.searchTokens = productSearchTokens(message)
    tools.add('inventory.stock')
  } else if (productWords || (stockWords && isBuyer)) {
    out.searchTokens = productSearchTokens(message)
    tools.add('search_catalog')
  }

  if (
    /\b(warehouse|warehouses|distribution center|fulfillment center|dc\b|locations?|sites)\b/.test(lower) &&
    !tools.has('inventory.stock') &&
    !tools.has('list_low_stock')
  ) {
    tools.add('list_warehouses')
  }

  if (!isBuyer && tools.size === 0 && /\b(search|find|lookup|look up|customers?)\b/.test(lower)) {
    const term = productSearchTokens(message)
      .filter((t) => t !== 'customer' && t !== 'customers')
      .join(' ')
    if (term) {
      out.searchTerm = term
      tools.add('global_search')
    }
  }

  if (tools.size === 0 && isBuyer && /\b(recent|status|help)\b/.test(lower)) {
    tools.add('orders.list')
  }

  out.tools = [...tools]
  return out
}
