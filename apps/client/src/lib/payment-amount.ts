// A plain decimal: optional minus, digits, optional fraction. Matches what the server accepts.
const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Why a typed payment amount would be rejected, or null when it is fine. Mirrors the server's
 * rules and messages so problems show before a card is tokenized; the server still decides.
 * Works in integer cents, so a one-cent balance compares exactly.
 */
export function paymentAmountError(text: string, balance: number): string | null {
  const m = DECIMAL.exec(text.trim())
  if (!m) return 'Payment amount must be a number, such as 25 or 25.50'
  const [, minus, whole, fraction = ''] = m
  if (minus || !/[1-9]/.test(whole + fraction)) return 'Payment amount must be greater than zero'
  if (fraction.length > 2) return 'Payment amount can have at most 2 decimal places'
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  const balanceCents = Math.round(balance * 100)
  if (cents > balanceCents) {
    return `Payment of ${dollars(cents)} is more than the remaining balance of ${dollars(balanceCents)}`
  }
  return null
}
