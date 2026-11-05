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
  parseRequisitionRef,
  OPEN_REQUISITION_STATUSES,
  productSearchTokens,
  resolveDateRange,
  type BillStatusFilter,
  type DateRange,
  type OrderChannelFilter,
  type OrderPriorityFilter,
  type OrderStatusFilter,
  type PoStatusFilter,
  type QuoteStatusFilter,
  type RequisitionStatusFilter,
  type SortDirection,
} from './erp-query-contracts'

export type CelestialToolName =
  | 'orders.list'
  | 'orders.detail'
  | 'inventory.stock'
  | 'purchasing.orders'
  | 'purchasing.order_detail'
  | 'purchasing.requisitions'
  | 'purchasing.requisition_detail'
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
  requisitionRef?: string
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
  /** The date range filters bills by due date ("bills due this month"). */
  byDueDate?: boolean
  requisitionStatus?: RequisitionStatusFilter
  /** Any of these requisition statuses ("open requisitions"). */
  requisitionStatuses?: RequisitionStatusFilter[]
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
  /\b(order|orders|invoice|invoices|warehouse|warehouses|stock|sku|skus|quote|quotes|customer|customers|bill|bills|purchase|requisition|requisitions|supplier|suppliers|vendor|vendors|product|products|inventory)\b/

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
  // "How do I approve an open requisition?" and "what is a requisition?" ask about the process.
  if (/\brequisitions?\b/.test(lower) && /\b(how (do|can|should|would) (i|we)|how to|what('s| is) an? (purchase )?requisition)\b/.test(lower)) return true
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

const APPROVAL_WAIT = /\b(awaiting|waiting for|pending|needs?) approval\b/

/** Every order status the question names: "pending and shipped orders" is both. */
function detectOrderStatuses(lower: string): OrderStatusFilter[] {
  const text = lower.replace(APPROVAL_WAIT, ' ')
  const found: OrderStatusFilter[] = APPROVAL_WAIT.test(lower) ? ['AWAITING_APPROVAL'] : []
  const checks: Array<[RegExp, OrderStatusFilter]> = [
    [/\bback.?order(ed|s)?\b/, 'BACKORDERED'],
    [/\b(pending|awaiting)\b/, 'PENDING'],
    [/\bconfirmed\b/, 'CONFIRMED'],
    [/\b(processing|in progress|being picked)\b/, 'PROCESSING'],
    [/\b(packed|ready to ship)\b/, 'PACKED'],
    [/\b(shipped|in transit)\b/, 'SHIPPED'],
    [/\b(delivered|completed)\b/, 'DELIVERED'],
    [/\b(cancelled|canceled)\b/, 'CANCELLED'],
    [/\bfailed\b/, 'FAILED'],
    [/\breturn(ed|s)?\b/, 'RETURNED'],
  ]
  for (const [words, status] of checks) if (words.test(text)) found.push(status)
  return found
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
  if (APPROVAL_WAIT.test(lower)) return 'PENDING_APPROVAL'
  if (/\bdrafts?\b/.test(lower)) return 'DRAFT'
  if (/\bsubmitted\b/.test(lower)) return 'SUBMITTED'
  if (/\b(closed|fully received)\b/.test(lower)) return 'CLOSED'
  if (/\b(cancelled|canceled)\b/.test(lower)) return 'CANCELLED'
  return undefined
}

function detectQuoteStatus(lower: string): QuoteStatusFilter | undefined {
  if (APPROVAL_WAIT.test(lower)) return 'PENDING_APPROVAL'
  if (/\bapproved\b/.test(lower)) return 'APPROVED'
  if (/\brejected\b/.test(lower)) return 'REJECTED'
  if (/\bsubmitted\b/.test(lower)) return 'SUBMITTED'
  if (/\bexpired\b/.test(lower)) return 'EXPIRED'
  if (/\bopen\b/.test(lower)) return 'OPEN'
  return undefined
}

function detectRequisitionStatus(lower: string): RequisitionStatusFilter | undefined {
  if (/\b(waiting|pending|awaiting|needs? approval|for approval)\b/.test(lower)) return 'PENDING_APPROVAL'
  if (/\bdrafts?\b/.test(lower)) return 'DRAFT'
  if (/\brejected\b/.test(lower)) return 'REJECTED'
  if (/\b(converted|became|become)\b/.test(lower) && !/\bnot (yet )?(been )?(converted|become)\b/.test(lower)) return 'CONVERTED'
  if (/\bapproved\b/.test(lower) || /\bnot (yet )?(been )?converted\b/.test(lower)) return 'APPROVED'
  if (/\b(cancelled|canceled)\b/.test(lower)) return 'CANCELLED'
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

const REQUISITION_WORDS = /\b(requisitions?|purchase requests?)\b/i
/** "Converted to a PO" describes a requisition; it is not a request for POs or orders as well. */
const CONVERSION_PHRASE = /\b(converted|turned|became|become)\s+(in)?(to\s+)?(an?\s+)?(POs?|purchase orders?|orders?)\b/gi

export function detectIntent(rawMessage: string, isBuyer: boolean, context?: { orderId?: string; quoteId?: string }): DetectedIntent {
  const message = REQUISITION_WORDS.test(rawMessage) ? rawMessage.replace(CONVERSION_PHRASE, '$1') : rawMessage
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

  const requisitionRef = parseRequisitionRef(message)
  if (requisitionRef) {
    out.requisitionRef = requisitionRef
    tools.add('purchasing.requisition_detail')
  } else if (REQUISITION_WORDS.test(message)) {
    tools.add('purchasing.requisitions')
    if (/\b(open|outstanding|in progress)\b/.test(lower)) out.requisitionStatuses = OPEN_REQUISITION_STATUSES
    else out.requisitionStatus = detectRequisitionStatus(lower)
    if (singleRecordWanted(message, /\brequisition\b/)) out.limit = 1
    out.supplier = detectSupplier(message)
  }

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
    // A bill "due" this month is one still to pay, and the period is its due date.
    const dueWord = /\bdue\b/.test(lower) && !out.pastDue
    if (dueWord && out.dateRange) out.byDueDate = true
    if (dueWord || /\b(unpaid|outstanding|open|owed?)\b/.test(lower)) out.outstanding = true
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
    if (/\b(past due|overdue|late)\b/.test(lower)) out.pastDue = true
    else if (/\bdue\b/.test(lower) && out.dateRange) out.byDueDate = true
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
        const statuses = detectOrderStatuses(salesText)
        if (statuses.length > 1) out.orderStatuses = statuses
        else out.orderStatus = statuses[0]
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
    (topProducts || /\b(sales|revenue|turnover|takings|sold|selling|sellers?|earn(ed|ings)?|(did|do) we sell)\b/.test(revenueText))
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

const NET_POSITION =
  /\bnet (position|positive|negative|balance)\b|\bwe owe\b.*\b(are owed|are we owed|owed to us|owes? us|customers? owe)\b|\b(are owed|are we owed|owed to us|owes? us|customers? owe)\b.*\bwe owe\b|\breceivables?\b.*\bpayables?\b|\bpayables?\b.*\breceivables?\b/
const SUPPLIER_ORDERED = /\b(ordered|bought|[Pp]urchase [Oo]rders?)\b|\bPOs?\b/
const SUPPLIER_BILLED = /\b(billed|bills?)\b/i
const STOCK_AND_SALES =
  /\b(stock|inventory|on.?hand)\b.*\band\b.*\b(sales|sold|sell|sells|selling)\b|\b(sales|sold|sell|sells|selling)\b.*\band\b.*\b(stock|inventory|on.?hand)\b/

/**
 * Questions that plainly ask for two linked lookups. These are answered without the AI router, so
 * a rate-limited or terse model can't quietly drop half of the question.
 */
export function detectCombination(message: string, isBuyer: boolean): DetectedIntent[] | null {
  if (isBuyer || isHowToQuestion(message)) return null
  const calls = combinationCalls(message)
  // A name these rules didn't pick up ("Acme orders and invoices") must not be dropped; the AI router reads it.
  return calls && namesCovered(message, calls) ? calls : null
}

/** Words that open a sentence with a capital but are never a name. */
const NOT_A_NAME_OPENER = /^(low|pending|open|unpaid|outstanding|overdue|shipped|delivered|cancelled|draft|approved|rejected|compare|sales|orders?|bills?|invoices?|quotes?|stock|inventory|requisitions?|receivables?|payables?|net|best|top|worst|are|were|was|did|who|when|why|also|then|so|how|what|which|where|any|show|list|give|tell|do|does|is|have|has)$/i

function namesCovered(message: string, calls: DetectedIntent[]): boolean {
  const known = calls
    .flatMap((c) => [c.customer, c.supplier, c.warehouse, c.searchTerm, ...(c.searchTokens ?? [])])
    .filter((v): v is string => Boolean(v))
    .join(' ')
    .toLowerCase()
  const words = [...message.matchAll(/\b[A-Z][\w&-]*/g)]
  return words.every((m) => {
    const word = m[0]
    if (known.includes(word.toLowerCase())) return true
    if (word === 'I' || /^[A-Z]{1,4}s?$/.test(word) || MONTHS.test(word) || NOT_A_NAME.test(word)) return true
    return m.index === 0 && NOT_A_NAME_OPENER.test(word)
  })
}

function combinationCalls(message: string): DetectedIntent[] | null {
  if (/\bORD-\d+|\bPO[-\s#]*\d+|\bQ-[A-Z0-9_]{4,}|\bPR[-\s#]*\d+/i.test(message)) return null
  const lower = message.toLowerCase()
  if (NET_POSITION.test(lower)) {
    return [
      { tools: ['list_my_invoices'], outstanding: true },
      { tools: ['finance.bills'], outstanding: true },
    ]
  }
  const dateRange = resolveDateRange(message)
  if (SUPPLIER_ORDERED.test(message.replace(/\bpos\b/g, '')) && SUPPLIER_BILLED.test(message)) {
    const supplier = message.match(/\b(?:from|for|by|supplier|vendor)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3})/)?.[1]?.trim()
    return [
      { tools: ['purchasing.orders'], supplier, dateRange },
      { tools: ['finance.bills'], supplier, dateRange },
    ]
  }
  // A ranking ("best selling", "most stock") has its own answer shape.
  if (STOCK_AND_SALES.test(lower) && !/\b(most|least|best|worst|top|bottom|highest|lowest)\b/.test(lower)) {
    const searchTokens = productSearchTokens(message)
    if (searchTokens.length === 0) return null
    return [
      { tools: ['inventory.stock'], searchTokens },
      { tools: ['sales.by_product'], searchTokens, dateRange },
    ]
  }
  return splitParts(message)
}

const PART_SEPARATOR = /\s*(?:[,;&]|\bas well as\b|\balong with\b|\band also\b|\band\b|\bplus\b)\s*/i
/** Too broad to count as a part of its own ("…and who is the customer"). */
const NOT_A_PART = new Set<CelestialToolName>(['global_search', 'list_warehouses'])

/** "Pending orders and low stock": each part that is a data question on its own becomes a lookup. */
function splitParts(message: string): DetectedIntent[] | null {
  const parts = message.split(PART_SEPARATOR).filter((p) => p.trim())
  if (parts.length < 2 || parts.length > 6) return null
  const calls: DetectedIntent[] = []
  for (const part of parts) {
    const intent = detectIntent(part, false)
    const tools = intent.tools.filter((t) => !NOT_A_PART.has(t))
    const period = resolveDateRange(part)
    if (tools.length > 0) calls.push({ ...intent, tools })
    // "Sales this quarter and last quarter": a part that is only a period repeats the lookup before it.
    else if (period && calls.length > 0) calls.push({ ...calls[calls.length - 1], dateRange: period })
  }
  if (calls.length < 2) return null
  // "Sales and orders this month": a period at the very end covers every part. A period in an
  // earlier part ("orders this month and unpaid invoices"), or one that says when the last part
  // falls due ("quotes and bills due this month"), stays with its own part.
  const last = parts[parts.length - 1]
  const closing = /\bdue\b/i.test(last) ? undefined : resolveDateRange(last)
  return closing ? calls.map((c) => (c.dateRange ? c : { ...c, dateRange: closing })) : calls
}

const TOPICS: Array<{ label: string; words: RegExp; answeredBy: CelestialToolName[] }> = [
  { label: 'sales orders', words: /\borders\b/, answeredBy: ['orders.list', 'orders.detail', 'sales.summary', 'sales.by_customer'] },
  {
    label: 'stock',
    words: /\b(stock|inventory)\b/,
    answeredBy: ['inventory.stock', 'inventory.by_warehouse', 'list_low_stock', 'search_catalog', 'sales.by_product'],
  },
  { label: 'vendor bills', words: /\b(bills?|billed|payables?)\b/, answeredBy: ['finance.bills', 'purchasing.order_detail', 'purchasing.suppliers'] },
  { label: 'customer invoices', words: /\b(invoices?|receivables?)\b/, answeredBy: ['list_my_invoices'] },
  { label: 'quotes', words: /\bquotes?\b/, answeredBy: ['quotes.list', 'quotes.detail'] },
  { label: 'purchase orders', words: /\bpurchase orders?\b|\bpos\b|\bpo\b/, answeredBy: ['purchasing.orders', 'purchasing.order_detail', 'purchasing.suppliers'] },
  { label: 'purchase requisitions', words: REQUISITION_WORDS, answeredBy: ['purchasing.requisitions', 'purchasing.requisition_detail'] },
  { label: 'sales', words: /\b(sales|revenue)\b/, answeredBy: ['sales.summary', 'sales.by_product', 'sales.by_customer', 'sales.forecast'] },
]

/**
 * Topics the question names that these lookups don't answer, so a dropped half is never silent. Only
 * applies when the question names at least two topics: with one, a mismatch just means different words.
 */
export function uncoveredTopics(message: string, tools: readonly string[]): string[] {
  const text = message
    .toLowerCase()
    .replace(/\b(converted|became|become|turned)\b.*\borders?\b/g, ' ')
    .replace(/\bon order\b/g, ' ')
    .replace(/\bsales orders?\b/g, 'orders')
    .replace(/\bsales (reps?|tax(es)?|channels?)\b/g, ' ')
  const salesOrderText = text.replace(/\b(purchase|supplier) orders?\b/g, ' ')
  const named = TOPICS.filter((t) => t.words.test(t.label === 'sales orders' ? salesOrderText : text))
  if (named.length < 2) return []
  return named.filter((t) => !t.answeredBy.some((name) => tools.includes(name))).map((t) => t.label)
}
