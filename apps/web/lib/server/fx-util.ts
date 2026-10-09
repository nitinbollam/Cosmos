/** Convert a foreign-currency amount to tenant base currency using a captured rate. */
export function toBaseAmount(amount: number, fxRateToBase: number): number {
  return +(amount * fxRateToBase).toFixed(2)
}

export function normalizeCurrency(code: string | undefined | null): string {
  const c = code?.trim().toUpperCase()
  if (!c || !/^[A-Z]{3}$/.test(c)) return 'USD'
  return c
}
