export type CelestialToolName =
  | 'get_my_orders'
  | 'get_order_detail'
  | 'list_my_invoices'
  | 'search_catalog'
  | 'list_my_quotes'
  | 'global_search'
  | 'list_low_stock'
  | 'list_warehouses'

export type DetectedIntent = {
  tools: CelestialToolName[]
  orderId?: string
  quoteId?: string
  searchTerm?: string
  orderStatus?: string
}

const ORDER_ID = /\b(seed_ord_[a-z0-9_]+|[a-z0-9]{20,})\b/i

export function isHowToQuestion(message: string): boolean {
  const lower = message.toLowerCase()
  if (/\bhow many\b/.test(lower)) return false
  if (
    /\b(show|list|find|search|any|pending|open|recent)\b/.test(lower) &&
    /\b(order|orders|invoice|invoices|warehouse|warehouses|stock|sku|quote|customer)\b/.test(lower)
  ) {
    return false
  }
  if (
    /\bwhat (are|is)\b/.test(lower) &&
    /\b(warehouse|warehouses|order|orders|invoice|invoices|quote|quotes|stock|sku|customer|customers)\b/.test(lower)
  ) {
    return false
  }
  return (
    /\b(how does|how do|how to|how is|how are|explain|walk me through|tell me about)\b/.test(lower) ||
    /\bhow\b[\s\S]{0,40}\b(work|works)\b/.test(lower)
  )
}

export function detectIntent(message: string, isBuyer: boolean, context?: { orderId?: string; quoteId?: string }): DetectedIntent {
  const lower = message.toLowerCase()
  const tools = new Set<CelestialToolName>()
  let orderId = context?.orderId
  let quoteId = context?.quoteId
  let searchTerm: string | undefined
  let orderStatus: string | undefined

  if (isHowToQuestion(message)) {
    return { tools: [], orderId, quoteId, searchTerm, orderStatus }
  }

  const idMatch = message.match(ORDER_ID)
  if (idMatch) orderId = idMatch[1]

  if (/\b(pending|awaiting)\b/.test(lower)) orderStatus = 'PENDING'
  if (/\b(processing|in progress|being picked)\b/.test(lower)) orderStatus = 'PROCESSING'
  if (/\b(packed|ready to ship)\b/.test(lower)) orderStatus = 'PACKED'
  if (/\b(shipped|in transit)\b/.test(lower)) orderStatus = 'SHIPPED'
  if (/\b(delivered|completed)\b/.test(lower)) orderStatus = 'DELIVERED'
  if (/\b(cancelled|canceled)\b/.test(lower)) orderStatus = 'CANCELLED'

  if (/\b(order|orders|shipment|ship|track|delivery|fulfillment|pending)\b/.test(lower)) {
    tools.add('get_my_orders')
    if (orderId) tools.add('get_order_detail')
  }
  if (/\b(invoice|bill|payment|balance|due|owe)\b/.test(lower)) {
    tools.add('list_my_invoices')
  }
  if (/\b(quote|counter.?offer|pricing)\b/.test(lower)) {
    tools.add('list_my_quotes')
    const qm = message.match(/\b(seed_quote_[a-z0-9_]+)\b/i)
    if (qm) quoteId = qm[1]
  }
  if (/\b(catalog|sku|product|stock|inventory|reorder|buy|item)\b/.test(lower)) {
    tools.add('search_catalog')
    const quoted = message.match(/"([^"]+)"/)?.[1]
    searchTerm = quoted ?? extractSearchTerm(message)
  }
  if (!isBuyer && /\b(search|find|lookup|customer)\b/.test(lower)) {
    tools.add('global_search')
    searchTerm = searchTerm ?? extractSearchTerm(message)
  }
  if (!isBuyer && /\b(low stock|reorder point|out of stock)\b/.test(lower)) {
    tools.add('list_low_stock')
  }
  if (/\b(warehouse|warehouses|distribution center|fulfillment center|dc\b|location|locations|sites)\b/.test(lower)) {
    tools.add('list_warehouses')
  }
  if (!isBuyer && /\bhow many\b/.test(lower) && /\b(warehouse|location|site|dc)\b/.test(lower)) {
    tools.add('list_warehouses')
  }

  if (tools.size === 0 && isBuyer && /\b(recent|status|help)\b/.test(lower)) {
    tools.add('get_my_orders')
  }

  return { tools: [...tools], orderId, quoteId, searchTerm, orderStatus }
}

function extractSearchTerm(message: string): string | undefined {
  const cleaned = message
    .replace(/\b(show|find|search|for|my|the|a|an|what|where|is|are|do|i|have|any)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length >= 2 ? cleaned.slice(0, 80) : undefined
}
