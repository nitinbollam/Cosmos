/** A quote line as the form holds it (all text). */
export type QuoteLineDraft = {
  lineNo: number
  skuCode: string
  description: string
  qty: string
  unitPrice: string
}

/**
 * The first problem with the lines, or null. Every line needs a product (SKU): without one an approved
 * quote can't become an order (ticket 55). Matches the server's checks.
 */
export function quoteLinesProblem(lines: QuoteLineDraft[]): string | null {
  if (lines.length === 0) return 'Add at least one line'
  for (const l of lines) {
    if (!l.skuCode.trim()) return `Line ${l.lineNo}: choose a product`
    const qty = Number(l.qty)
    if (!Number.isInteger(qty) || qty < 1) return `Line ${l.lineNo}: quantity must be a whole number of 1 or more`
    const price = Number(l.unitPrice)
    if (l.unitPrice.trim() === '' || !Number.isFinite(price) || price < 0) return `Line ${l.lineNo}: enter a unit price of 0 or more`
  }
  return null
}

/** Picking a product fills its code, and its name and price where the line has none yet. */
export function applyProduct(line: QuoteLineDraft, sku: { code: string; name: string; price: string | number }): QuoteLineDraft {
  const blankDescription = !line.description.trim() || line.description.trim() === 'Item'
  const blankPrice = !line.unitPrice.trim() || Number(line.unitPrice) === 0
  return {
    ...line,
    skuCode: sku.code,
    description: blankDescription ? sku.name : line.description,
    unitPrice: blankPrice ? String(Number(sku.price)) : line.unitPrice,
  }
}
