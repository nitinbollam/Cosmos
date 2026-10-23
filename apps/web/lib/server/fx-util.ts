import { Prisma } from '@/generated/prisma-order'

/**
 * Convert to the base currency. Done in decimal, rounded half away from zero to cents, so
 * 1.005 -> 1.01 (binary floats and `toFixed` give 1.00). Returns a number for the callers that still
 * take one; use `toBaseDecimal` where the result feeds more arithmetic.
 */
export function toBaseDecimal(amount: number | string | Prisma.Decimal, fxRateToBase: number | string | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(String(amount)).times(String(fxRateToBase)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

export function toBaseAmount(amount: number, fxRateToBase: number): number {
  return toBaseDecimal(amount, fxRateToBase).toNumber()
}

export function normalizeCurrency(code: string | undefined | null): string {
  const c = code?.trim().toUpperCase()
  if (!c || !/^[A-Z]{3}$/.test(c)) return 'USD'
  return c
}
