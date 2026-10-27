/** A line in the New purchase order form, as typed (numbers are kept as text until saved). */
export type PoFormLine = { key: number; skuCode: string; description: string; qtyOrdered: string; unitCost: string }

/** Blank text is "not entered", never 0. */
export function parseFormNumber(v: string): number {
  return v.trim() === '' ? NaN : Number(v)
}

/**
 * What's wrong with each line, by field, so the form can say exactly what to fix. The server checks
 * the same rules and also that the SKU exists.
 */
export function poLineProblems(lines: PoFormLine[]): string[][] {
  const firstLineBySku = new Map<string, number>()
  return lines.map((l, i) => {
    const problems: string[] = []
    const code = l.skuCode.trim()
    if (!code) problems.push('SKU code is required')
    else if (firstLineBySku.has(code)) problems.push(`SKU ${code} is already on line ${firstLineBySku.get(code)}`)
    else firstLineBySku.set(code, i + 1)
    const qty = parseFormNumber(l.qtyOrdered)
    if (!Number.isInteger(qty) || qty < 1) problems.push('Quantity must be a whole number of 1 or more')
    const cost = parseFormNumber(l.unitCost)
    if (!(cost >= 0)) problems.push("Enter a unit cost (0 if it's free)")
    return problems
  })
}
