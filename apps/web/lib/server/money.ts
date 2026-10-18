import { Prisma } from '@/generated/prisma-order'

/**
 * The one place money arithmetic happens (PLR-159).
 *
 * Rules: money is a `Decimal` internally and integer cents at boundaries that need them; amounts
 * enter as decimal strings, Decimals or cents, never as a float that was the result of arithmetic.
 * Rounding is to 2 places, half away from zero (0.005 -> 0.01, -0.005 -> -0.01), applied once at the
 * end of a calculation rather than at each step. API output uses decimal strings (`formatMoney`).
 */
export type Decimal = Prisma.Decimal
export type MoneyValue = string | Decimal

const D = Prisma.Decimal
const ZERO = new D(0)

/** Parse a decimal string or pass a Decimal through. Rejects anything that is not a finite number. */
export function money(value: MoneyValue): Decimal {
  const d = new D(value)
  if (!d.isFinite()) throw new RangeError(`Not a money amount: ${String(value)}`)
  return d
}

/**
 * Convert a float from a boundary that still hands them over (older code, JSON bodies). It goes
 * through the shortest decimal string for the float, so 0.1 + 0.2 style noise is not carried into
 * the amount, and is then rounded to cents. New code should not need this.
 */
export function fromFloat(value: number): Decimal {
  if (!Number.isFinite(value)) throw new RangeError(`Not a money amount: ${value}`)
  return roundMoney(new D(String(value)))
}

/** Round to 2 decimal places, half away from zero. */
export function roundMoney(value: MoneyValue): Decimal {
  return new D(value).toDecimalPlaces(2, D.ROUND_HALF_UP)
}

/** Whole cents as an integer (rounds first). Throws if the amount is too large to hold exactly. */
export function toCents(value: MoneyValue): number {
  const cents = roundMoney(value).times(100).toNumber()
  if (!Number.isSafeInteger(cents)) throw new RangeError(`Amount too large for integer cents: ${String(value)}`)
  return cents
}

export function fromCents(cents: number | bigint): Decimal {
  if (typeof cents === 'number' && !Number.isInteger(cents)) throw new RangeError(`Cents must be an integer: ${cents}`)
  return new D(cents.toString()).div(100)
}

/** Exact sum; rounds nothing. */
export function sum(values: Iterable<MoneyValue>): Decimal {
  let total = ZERO
  for (const v of values) total = total.plus(v)
  return total
}

/** `amount * rate`, rounded once. `rate` is a fraction as a string or Decimal ("0.07" for 7%). */
export function percentOf(amount: MoneyValue, rate: MoneyValue): Decimal {
  return roundMoney(new D(amount).times(rate))
}

/** Two-decimal string for API output and display. */
export function formatMoney(value: MoneyValue): string {
  return roundMoney(value).toFixed(2)
}

/**
 * Split `total` across `weights` in whole cents using the largest-remainder method, so the parts
 * add back to the total exactly. Ties go to the earlier weight. Negative totals split by magnitude.
 */
export function allocate(total: MoneyValue, weights: MoneyValue[]): Decimal[] {
  if (weights.length === 0) throw new RangeError('allocate needs at least one weight')
  const w = weights.map((x) => new D(x))
  if (w.some((x) => x.isNegative())) throw new RangeError('allocate weights must not be negative')
  const weightSum = w.reduce((s, x) => s.plus(x), ZERO)
  if (weightSum.isZero()) throw new RangeError('allocate weights must not all be zero')

  const totalCents = toCents(total)
  const sign = totalCents < 0 ? -1 : 1
  const magnitude = Math.abs(totalCents)
  const exact = w.map((x) => x.times(magnitude).div(weightSum))
  const floors = exact.map((x) => x.floor().toNumber())
  let left = magnitude - floors.reduce((a, b) => a + b, 0)
  const order = exact
    .map((x, i) => ({ i, frac: x.minus(x.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] += 1
    left -= 1
  }
  return floors.map((c) => fromCents(sign * c))
}
