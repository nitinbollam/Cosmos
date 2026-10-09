export const B2B_CART_KEY = 'pleros_b2b_cart'

export type B2bCartLine = {
  skuCode: string
  description: string
  qty: number
  unitPrice: number
}

export function readCart(): B2bCartLine[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(B2B_CART_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => {
        if (!x || typeof x !== 'object') return null
        const o = x as Record<string, unknown>
        const skuCode = typeof o.skuCode === 'string' ? o.skuCode.trim() : ''
        const description = typeof o.description === 'string' ? o.description : ''
        const qty = typeof o.qty === 'number' && o.qty >= 1 ? Math.floor(o.qty) : 1
        const unitPrice =
          typeof o.unitPrice === 'number'
            ? o.unitPrice
            : typeof o.unitPrice === 'string'
              ? Number.parseFloat(o.unitPrice) || 0
              : 0
        if (!skuCode) return null
        return { skuCode, description: description || skuCode, qty, unitPrice }
      })
      .filter((x): x is B2bCartLine => x !== null)
  } catch {
    return []
  }
}

export function writeCart(lines: B2bCartLine[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(B2B_CART_KEY, JSON.stringify(lines))
  window.dispatchEvent(new Event('pleros-cart-changed'))
}

export function clearCart() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(B2B_CART_KEY)
  window.dispatchEvent(new Event('pleros-cart-changed'))
}

/** Merge by skuCode: add qty, refresh description and unit price from latest add. */
export function addToCart(line: B2bCartLine) {
  const cur = readCart()
  const idx = cur.findIndex((c) => c.skuCode.toLowerCase() === line.skuCode.toLowerCase())
  if (idx >= 0) {
    const next = [...cur]
    next[idx] = {
      skuCode: line.skuCode,
      description: line.description,
      qty: next[idx].qty + line.qty,
      unitPrice: line.unitPrice,
    }
    writeCart(next)
  } else {
    writeCart([...cur, { ...line, qty: Math.max(1, line.qty) }])
  }
}

export function cartTotalLines(lines: B2bCartLine[]): number {
  return lines.reduce((s, l) => s + l.qty, 0)
}
