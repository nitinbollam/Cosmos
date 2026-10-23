/** Field sales helpers for the mobile app (PLR-170). Pure, so each rule is tested on its own. */

export type CatalogItem = { id: string; code: string; name: string; listPrice: number; unitPrice: number; source: string }
export type CartLine = { skuId: string; code: string; name: string; unitPrice: number; quantity: number }

export const money = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function addToCart(cart: CartLine[], item: CatalogItem, quantity = 1): CartLine[] {
  const existing = cart.find((l) => l.skuId === item.id)
  if (existing) return cart.map((l) => (l.skuId === item.id ? { ...l, quantity: l.quantity + quantity } : l))
  return [...cart, { skuId: item.id, code: item.code, name: item.name, unitPrice: item.unitPrice, quantity }]
}

/** Quantity 0 (or blank) removes the line. */
export function setQuantity(cart: CartLine[], skuId: string, raw: string): CartLine[] {
  const q = Math.floor(Number(raw))
  if (!Number.isFinite(q) || q <= 0) return cart.filter((l) => l.skuId !== skuId)
  return cart.map((l) => (l.skuId === skuId ? { ...l, quantity: q } : l))
}

/** Whole cents to avoid float drift. The server prices the real order. */
export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((s, l) => s + Math.round(l.unitPrice * 100) * l.quantity, 0) / 100
}

/** What the server is sent: only item and quantity. Prices are never sent. */
export function cartPayload(cart: CartLine[]): Array<{ skuId: string; quantity: number }> {
  return cart.map((l) => ({ skuId: l.skuId, quantity: l.quantity }))
}

export type CreditView = { creditLimit: number | null; openBalance: number; availableCredit: number | null }

export function creditLabel(c: CreditView): string {
  if (c.creditLimit == null || c.creditLimit <= 0) return 'No credit limit set'
  const left = c.availableCredit ?? 0
  return left < 0 ? `${money(-left)} over limit` : `${money(left)} available of ${money(c.creditLimit)}`
}

/** Would this order, on terms, go past the limit? Shown as a warning before sending. */
export function overLimitBy(c: CreditView, orderTotal: number): number {
  if (c.availableCredit == null) return 0
  const over = orderTotal - c.availableCredit
  return over > 0 ? Math.round(over * 100) / 100 : 0
}

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'LOST'] as const

export function isOpenLead(status: string): boolean {
  return status !== 'WON' && status !== 'LOST'
}

export function leadAction(l: { assignedToUserId?: string | null; status: string }, me: string | null): 'claim' | 'work' | 'closed' | 'taken' {
  if (!isOpenLead(l.status)) return 'closed'
  if (!l.assignedToUserId) return 'claim'
  return l.assignedToUserId === me ? 'work' : 'taken'
}

export function creditRequestProblem(requested: string, reason: string, current: number | null): string | null {
  const n = Number(requested)
  if (requested.trim() === '' || !Number.isFinite(n) || n <= 0) return 'Enter the limit you want'
  if (current != null && n <= current) return `Must be above the current limit of ${money(current)}`
  if (reason.trim().length < 5) return 'Say why the account needs more credit'
  return null
}
