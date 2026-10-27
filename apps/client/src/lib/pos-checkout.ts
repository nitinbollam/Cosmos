/**
 * Pure rules for the POS checkout screen, kept out of the page so they can be tested:
 * how much of the sale is paid in cash, the change due, which register name comes next, and
 * the plain-language reason "Complete sale" is disabled.
 */

export type TenderMethod = 'CASH' | 'CARD' | 'CHECK' | 'GIFT_CARD'

const cents = (n: number) => Math.round(n * 100)

/** The part of the sale the customer pays in cash (split tenders count only their cash leg). */
export function cashDue(opts: {
  total: number
  method: TenderMethod
  split: boolean
  secondMethod: TenderMethod
  secondAmount: string
}): number {
  const second = Number(opts.secondAmount)
  if (opts.split && Number.isFinite(second) && second > 0 && second < opts.total) {
    const first = (cents(opts.total) - cents(second)) / 100
    return ((opts.method === 'CASH' ? cents(first) : 0) + (opts.secondMethod === 'CASH' ? cents(second) : 0)) / 100
  }
  return opts.method === 'CASH' ? opts.total : 0
}

/** Change to hand back, or null while nothing valid has been entered. Never negative. */
export function changeDue(cashReceived: string, due: number): number | null {
  if (!cashReceived.trim()) return null
  const got = Number(cashReceived)
  if (!Number.isFinite(got) || got < 0) return null
  return Math.max(0, (cents(got) - cents(due)) / 100)
}

/** The amount still missing when cash is owed but the amount received is blank or short; null otherwise. */
export function cashShortfall(cashReceived: string, due: number): number | null {
  if (due <= 0) return null
  const got = cashReceived.trim() === '' ? 0 : Number(cashReceived)
  if (!Number.isFinite(got)) return due
  const short = (cents(due) - cents(got)) / 100
  return short > 0 ? short : null
}

/** "Register 7" when the highest existing "Register N" is 6, whatever order they were created in. */
export function nextRegisterName(names: string[]): string {
  let max = 0
  for (const n of names) {
    const m = /^Register\s+(\d+)$/i.exec(n.trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `Register ${max + 1}`
}

/** Register 2 before Register 10. */
export function sortRegisters<T extends { name: string }>(registers: T[]): T[] {
  return [...registers].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
}

export type CheckoutState = {
  hasShift: boolean
  hasOpenTill: boolean
  hasRegister: boolean
  hasWarehouse: boolean
  hasCustomer: boolean
  cartCount: number
  discountPending: boolean
  needsIdScan: boolean
  splitIncomplete: boolean
  /** Largest valid second-tender amount, for the message. */
  secondMax: number
  cashRequired: number
  cashReceived: string
}

const money = (n: number) => `$${n.toFixed(2)}`

/** Why the sale can't be completed yet, in the order a cashier would fix it; null when it can. */
export function checkoutBlocker(s: CheckoutState): string | null {
  if (!s.hasShift) return 'Clock in to start selling.'
  if (!s.hasOpenTill) return 'Open the till session to take payments.'
  if (!s.hasRegister) return 'Pick a register for this sale.'
  if (!s.hasWarehouse) return 'No warehouse is set up for this register.'
  if (!s.hasCustomer) return 'Choose a customer (or Walk-in) for this sale.'
  if (s.cartCount === 0) return 'Add at least one item to the sale.'
  if (s.discountPending) return 'The discount is waiting for manager approval. Remove the code or wait.'
  if (s.needsIdScan) return "Scan the buyer's ID to continue."
  if (s.splitIncomplete) return `Enter the second payment amount (between $0.01 and ${money(Math.max(0, s.secondMax))}).`
  const short = cashShortfall(s.cashReceived, s.cashRequired)
  if (short != null) {
    return s.cashReceived.trim() === ''
      ? `Enter the cash received (${money(s.cashRequired)} due).`
      : `Cash received is ${money(short)} short of ${money(s.cashRequired)}.`
  }
  return null
}
