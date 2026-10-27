import {
  stockRankOf,
  salesRankOf,
  answerLimit,
  priceRankOf,
  singleRecordWanted,
  OPEN_ORDER_STATUSES,
  OPEN_PO_STATUSES,
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
  | 'sales.summary'
  | 'sales.forecast'
  | 'sales.by_product'
  | 'sales.by_customer'
  | 'purchasing.suppliers'
  | 'inventory.by_warehouse'
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
  /** Rank products by total available stock ("least stock" → asc). */
  stockRank?: SortDirection
  /** Rank products by sales ("best selling" → desc). */
  salesRank?: SortDirection
  /** Ranked results wanted: 1 for "which product has the most…", N for "top N". */
  limit?: number
  /** Any of these order statuses ("waiting to ship" = every not-yet-shipped status). */
  orderStatuses?: OrderStatusFilter[]
  /** Any of these purchase-order statuses ("still to receive"). */
  poStatuses?: PoStatusFilter[]
  /** Customer name filter for orders, quotes and invoices. */
  customer?: string
  /** Rank products by price ("cheapest" → asc). */
  priceRank?: SortDirection
  /** Order by amount instead of date ("biggest order"). */
  byAmount?: boolean
  /** Warehouse name filter for stock ("in Newark"). */
  warehouse?: string
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
  // "How are sales this month?" asks for data; only procedural questions are how-to.
  return (
    /\b(how does|how do|how to|how can i|how should i|how would i|explain|walk me through)\b/.test(lower) ||
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
const NOT_A_NAME = /^(PO|ORD|Q|Pleros|Celestial|Shopify|Amazon|Walmart|Ebay|EDI|API|POS|Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|^(PO|ORD|Q)-?\d*$/i

/** Customer named in the question: "orders from Acme", "Acme's quote", "invoices for Acme Retail". */
function detectCustomer(message: string): string | undefined {
  const possessive = message.match(/\b([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3})'s\b/)?.[1]
  const after = message.match(/\b(?:from|for|by|of|customer)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3})/)?.[1]
  const name = (possessive ?? after)?.trim()
  if (!name || MONTHS.test(name) || NOT_A_NAME.test(name)) return undefined
  return name
}

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

  // Questions with their own answer shape, checked before the generic keyword groups.
  const customerRank =
    !isBuyer &&
    /\b(best|top|biggest|largest|most valuable|worst|smallest)\s+(\d+\s+)?(customers?|clients?|buyers?|accounts?)\b|\bwho (orders|buys|spends|purchases) (the )?most\b|\b(customers?|clients?) (who|that) (orders?|buys?|spends?) (the )?most\b|\bwhich (customers?|clients?) (orders?|buys?|spends?|purchases?) (the )?(most|least)\b/.test(lower)
  const averageOrder = /\b(average order (value|size|amount)|aov|avg\.? order)\b/.test(lower)
  const quoteConversion = /\b(quotes?|quotations?)\b/.test(lower) && /\bconvert/.test(lower)
  const warehouseRank =
    /\bwhich warehouses?\b|\bwarehouses? (has|have|holds?|with) the (most|least|biggest|smallest|highest|lowest)\b|\bwarehouse totals?\b|\bstock (per|by) warehouse totals?\b/.test(lower) &&
    !/\b(sku|skus|products?|items?)\b/.test(lower)
  const supplierList =
    /\b(suppliers|vendors|supplier list|vendor list)\b/.test(lower) &&
    /\b(who|list|show|all|our|which|what)\b/.test(lower) &&
    !/\b(bills?|orders?|ordered|bought|purchased|buy|pos?|owe|invoices?|paid)\b/.test(lower)
  const openPo =
    /\b(still to (be )?receive[d]?|yet to (be )?receive[d]?|to be received|not (yet )?(been )?received|awaiting (receipt|delivery)|incoming (stock|goods|deliver(y|ies)|shipments?)|on order|open (purchase orders?|pos?)|outstanding (purchase orders?|pos?))\b/.test(lower)

  if (customerRank) {
    tools.add('sales.by_customer')
    out.salesRank = salesRankOf(message)
    out.limit = answerLimit(message.replace(/\bcustomers\b/gi, 'customer')) ?? (/\bcustomers\b/.test(lower) ? undefined : 1)
  }
  if (averageOrder && !isBuyer) tools.add('sales.summary')
  if (warehouseRank && !isBuyer) {
    tools.add('inventory.by_warehouse')
    out.stockRank = stockRankOf(message) ?? 'desc'
    out.limit = /\bwhich warehouse\b/.test(lower) && /\b(most|least|biggest|smallest|highest|lowest)\b/.test(lower) ? 1 : undefined
  }
  if (supplierList && !isBuyer) tools.add('purchasing.suppliers')
  const customer = detectCustomer(message)

  // Purchasing first, so "purchase order" never reads as a sales order.
  const poRef = parsePoRef(message)
  const mentionsPurchasing =
    !supplierList &&
    (Boolean(poRef) ||
      openPo ||
      /\b(ordered|bought|purchased|buying) from (our )?(suppliers?|vendors?)\b|\bwhat (have |did )?we (ordered|bought)\b/.test(lower) ||
      /\bpurchase orders?\b|\bprocurement\b|\bsupplier orders?\b/.test(lower) ||
      /\bPOs?\b/.test(message))
  const salesText = lower.replace(/\bpurchase orders?\b/g, ' ').replace(/\bsupplier orders?\b/g, ' ')

  if (mentionsPurchasing) {
    if (poRef) {
      out.poRef = poRef
      tools.add('purchasing.order_detail')
    } else {
      tools.add('purchasing.orders')
      out.poStatus = detectPoStatus(lower)
      if (!out.poStatus && openPo) out.poStatuses = OPEN_PO_STATUSES
      if (singleRecordWanted(message, /\b(purchase order|po)\b/)) out.limit = 1
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
    out.customer = customer
    if (/\b(unpaid|outstanding|open|owed?|owing|overdue|due|not (yet )?paid)\b/.test(lower)) out.outstanding = true
  }

  const orderNumber = parseOrderNumberRef(salesText)
  const idMatch = message.match(ORDER_ID)
  if (idMatch) out.orderId = idMatch[1]
  const orderWords =
    /\bORD-\d+\b/i.test(salesText) ||
    /\b(orders?|shipments?|shipped|track|tracking|delivery|fulfillment|back.?orders?|back.?ordered)\b/.test(salesText)
  if (orderWords && !customerRank && !averageOrder && !quoteConversion && !openPo) {
    if (orderNumber != null || out.orderId) {
      out.orderNumber = orderNumber
      tools.add('orders.detail')
    } else {
      tools.add('orders.list')
      // "Waiting to ship" / "open orders" = every status before shipping.
      if (/\b(waiting to (ship|be shipped|go out)|to be shipped|not (yet )?shipped|unshipped|unfulfilled|open orders?|outstanding orders?|still to ship|need(s)? to (ship|go out)|yet to ship)\b/.test(salesText)) {
        out.orderStatuses = OPEN_ORDER_STATUSES
      } else {
        out.orderStatus = detectOrderStatus(salesText)
      }
      out.channel = detectChannel(salesText)
      out.priority = detectPriority(salesText)
      out.customer = customer
      if (/\b(biggest|largest|highest.?value|most valuable|smallest|lowest.?value)\b/.test(salesText)) {
        out.byAmount = true
        out.sort = /\b(smallest|lowest.?value)\b/.test(salesText) ? 'asc' : 'desc'
      }
      if (singleRecordWanted(message, /\border\b/)) out.limit = 1
    }
  }

  const quoteRef = parseQuoteRef(message)
  if (quoteRef || out.quoteId) {
    out.quoteRef = quoteRef
    tools.add('quotes.detail')
  } else if (/\b(quotes?|quotations?|counter.?offers?)\b/.test(lower)) {
    tools.add('quotes.list')
    out.quoteStatus = detectQuoteStatus(lower)
    out.customer = customer
    if (singleRecordWanted(message, /\b(quote|quotation)\b/)) out.limit = 1
  }

  // "Sales rep", "sales order" and "sales tax" are about orders or tax, not sales totals.
  const revenueText = lower.replace(/\bsales (reps?|orders?|tax(es)?|channels?)\b/g, ' ')
  const topProducts = /\b(top|best|worst|bottom|most popular|least popular)\s+(\d+\s+)?(products?|items?|skus?|sellers?)\b/.test(revenueText)
  const salesQuestion =
    !isBuyer &&
    !customerRank &&
    !averageOrder &&
    (topProducts || /\b(sales|revenue|turnover|takings|sold|selling|sellers?|earn(ed|ings)?)\b/.test(revenueText))
  // "Which product sells best" ranks products by sales; it must not also run a product search.
  const productSales =
    salesQuestion &&
    topProducts ||
    salesQuestion &&
    /\b(products?|items?|skus?|stock|lines?|sellers?|(best|worst|top|most|least|highest|lowest|fastest|slowest).?(selling|sold|sellers?)|sold (the )?(most|least))\b/.test(revenueText)
  if (salesQuestion) {
    if (/\b(predict(ed|ion|ions)?|forecast(s|ed)?|project(ed|ion|ions)?|expect(ed)?|estimate[sd]?|outlook|next (quarter|month|year))\b/.test(revenueText)) {
      tools.add('sales.forecast')
    } else if (productSales) {
      tools.add('sales.by_product')
      out.salesRank = salesRankOf(message)
      out.limit = answerLimit(message)
      out.searchTokens = productSearchTokens(message)
    } else {
      tools.add('sales.summary')
    }
  }

  const lowStock = !isBuyer && /\b(low stock|low on stock|running low|below reorder|reorder point|out of stock)\b/.test(lower)
  const stockWords = /\b(stock|on.?hand|available|availability|inventory|reserved|in each warehouse|by warehouse|per warehouse|how many units)\b/.test(lower)
  const productWords = /\b(catalog|sku|skus|products?|items?)\b/.test(lower)
  const priceRank = priceRankOf(message)
  if (productSales || customerRank || warehouseRank) {
    // Already answered by a ranking above.
  } else if (priceRank) {
    out.priceRank = priceRank
    out.searchTokens = productSearchTokens(message)
    out.limit = answerLimit(message)
    tools.add('search_catalog')
  } else if (lowStock) {
    tools.add('list_low_stock')
  } else if (stockWords && !isBuyer) {
    // "what is in stock in Newark" filters by warehouse; the place name is not a product word.
    const place = message.match(/\b(?:in|at)\s+(?:the\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,3})/)?.[1]
    if (place && !MONTHS.test(place) && !NOT_A_NAME.test(place)) out.warehouse = place
    const placeWords = new Set((out.warehouse ?? '').toLowerCase().split(/\s+/))
    out.searchTokens = productSearchTokens(message).filter((t) => !placeWords.has(t))
    out.stockRank = stockRankOf(message)
    if (out.stockRank) out.limit = answerLimit(message)
    tools.add('inventory.stock')
  } else if (productWords || (stockWords && isBuyer)) {
    out.searchTokens = productSearchTokens(message)
    tools.add('search_catalog')
  }

  if (
    /\b(warehouse|warehouses|distribution center|fulfillment center|dc\b|locations?|sites)\b/.test(lower) &&
    !tools.has('inventory.stock') &&
    !tools.has('list_low_stock') &&
    !tools.has('inventory.by_warehouse')
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
