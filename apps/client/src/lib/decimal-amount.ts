/**
 * Exact decimal amounts for purchasing forms, as strings. Arithmetic is done on integers scaled by 10^4 (BigInt), so
 * 0.1 + 0.2 is 0.3 and 3 x 0.3333 is 0.9999. Nothing here uses JS floating point.
 *
 * Limits match the server's requisition rules: 0 or more, at most 4 decimal places, below 1,000,000,000.
 */

export const AMOUNT_DECIMALS = 4
const SCALE = 10n ** BigInt(AMOUNT_DECIMALS)
const MAX = 1_000_000_000n * SCALE

export type ParsedAmount = { ok: true; value: string } | { ok: false; error: string }

/** Validates a typed amount ("12.50", ".5", "0") and returns its canonical form ("12.5", "0.5", "0"). */
export function parseAmountInput(raw: string, label = 'Amount'): ParsedAmount {
  const text = raw.trim()
  if (text === '') return { ok: false, error: `${label} is required` }
  if (text.startsWith('-')) return { ok: false, error: `${label} must be 0 or more` }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text)
  if (!m || (m[1] === '' && !m[2])) return { ok: false, error: `${label} must be a number like 12.50` }
  const frac = m[2] ?? ''
  if (frac.length > AMOUNT_DECIMALS) return { ok: false, error: `${label} can have at most ${AMOUNT_DECIMALS} decimal places` }
  const scaled = toScaled(`${m[1] || '0'}.${frac}`)
  if (scaled >= MAX) return { ok: false, error: `${label} must be below 1,000,000,000` }
  return { ok: true, value: fromScaled(scaled) }
}

/** An amount string (as typed after validation, or as the API returns it) as an integer count of 1/10^4. */
export function toScaled(value: string | number | null | undefined): bigint {
  if (value == null) return 0n
  const text = String(value).trim()
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!m) throw new Error(`Not an exact decimal amount: ${text}`)
  const frac = (m[3] ?? '').padEnd(AMOUNT_DECIMALS, '0')
  if (frac.length > AMOUNT_DECIMALS && /[1-9]/.test(frac.slice(AMOUNT_DECIMALS))) {
    throw new Error(`More than ${AMOUNT_DECIMALS} decimal places: ${text}`)
  }
  const n = BigInt(m[2] || '0') * SCALE + BigInt(frac.slice(0, AMOUNT_DECIMALS) || '0')
  return m[1] === '-' ? -n : n
}

/** Canonical string: no trailing zeros, no exponent. */
export function fromScaled(n: bigint): string {
  const neg = n < 0n
  const abs = neg ? -n : n
  const whole = abs / SCALE
  const frac = (abs % SCALE).toString().padStart(AMOUNT_DECIMALS, '0').replace(/0+$/, '')
  return `${neg && abs !== 0n ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

export function lineAmount(unitCost: string | number | null | undefined, qty: number): string {
  if (!Number.isInteger(qty)) throw new Error('Quantity must be a whole number')
  return fromScaled(toScaled(unitCost) * BigInt(qty))
}

export function sumAmounts(values: Array<string | number | null | undefined>): string {
  return fromScaled(values.reduce<bigint>((s, v) => s + toScaled(v), 0n))
}

export function compareAmounts(a: string | number, b: string | number): number {
  const d = toScaled(a) - toScaled(b)
  return d === 0n ? 0 : d < 0n ? -1 : 1
}

/**
 * For display: thousands separators, at least 2 decimals, exact beyond that ("4,262.5" -> "4,262.50",
 * "0.9999" stays "0.9999"). USD gets a "$"; other currencies get their code.
 */
export function formatAmount(value: string | number | null | undefined, currency = 'USD', opts?: { grouping?: boolean }): string {
  let text: string
  try {
    text = fromScaled(toScaled(value))
  } catch {
    return String(value)
  }
  const neg = text.startsWith('-')
  const [whole, frac = ''] = (neg ? text.slice(1) : text).split('.')
  // grouping: false keeps plain amounts ("$4262.50") on screens that already show them that way.
  const grouped = opts?.grouping === false ? whole : whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = `${grouped}.${frac.padEnd(2, '0')}`
  const sign = neg ? '-' : ''
  return currency === 'USD' ? `${sign}$${body}` : `${sign}${body} ${currency}`
}
