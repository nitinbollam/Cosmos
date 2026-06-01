export type CelestialToolName =
  | 'get_my_orders'
  | 'get_order_detail'
  | 'list_my_invoices'
  | 'search_catalog'
  | 'list_my_quotes'
  | 'global_search'
  | 'list_low_stock'

export type DetectedIntent = {
  tools: CelestialToolName[]
  orderId?: string
  quoteId?: string
  searchTerm?: string
}

const ORDER_ID = /\b(seed_ord_[a-z0-9_]+|[a-z0-9]{20,})\b/i

export function detectIntent(message: string, isBuyer: boolean, context?: { orderId?: string; quoteId?: string }): DetectedIntent {
  const lower = message.toLowerCase()
  const tools = new Set<CelestialToolName>()
  let orderId = context?.orderId
  let quoteId = context?.quoteId
  let searchTerm: string | undefined

  const idMatch = message.match(ORDER_ID)
  if (idMatch) orderId = idMatch[1]

  if (/\b(order|shipment|ship|track|delivery|fulfillment)\b/.test(lower)) {
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

  if (tools.size === 0 && !isBuyer && lower.length > 3) {
    tools.add('global_search')
    searchTerm = extractSearchTerm(message)
  }
  if (tools.size === 0 && isBuyer && /\b(recent|status|help)\b/.test(lower)) {
    tools.add('get_my_orders')
  }

  return { tools: [...tools], orderId, quoteId, searchTerm }
}

function extractSearchTerm(message: string): string | undefined {
  const cleaned = message
    .replace(/\b(show|find|search|for|my|the|a|an|what|where|is|are|do|i|have|any)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length >= 2 ? cleaned.slice(0, 80) : undefined
}
