/**
 * Money helpers for the bank reconciliation screen. The API sends amounts as 2-decimal strings;
 * selection totals are summed in whole cents (BigInt) so the UI never adds floats.
 */

const AMOUNT = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/

/** "123.45" / "-0.5" / "12" → cents. Throws on anything that is not a plain decimal amount. */
export function toCents(amount: string): bigint {
  const m = AMOUNT.exec(amount.trim())
  if (!m) throw new Error(`Not an amount: ${amount}`)
  const cents = BigInt(m[2]!) * 100n + BigInt((m[3] ?? '').padEnd(2, '0'))
  return m[1] === '-' ? -cents : cents
}

export function centsToAmount(cents: bigint): string {
  const neg = cents < 0n
  const abs = neg ? -cents : cents
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

export function sumAmounts(amounts: string[]): string {
  return centsToAmount(amounts.reduce((total, a) => total + toCents(a), 0n))
}

/** Display only: "-1234.50" → "-$1,234.50". The value is never used for arithmetic. */
export function formatAmount(amount: string, currency = 'USD'): string {
  const cents = toCents(amount)
  const neg = cents < 0n
  const abs = neg ? -cents : cents
  const whole = (abs / 100n).toLocaleString('en-US')
  const symbol = currency === 'USD' ? '$' : `${currency} `
  return `${neg ? '-' : ''}${symbol}${whole}.${String(abs % 100n).padStart(2, '0')}`
}
