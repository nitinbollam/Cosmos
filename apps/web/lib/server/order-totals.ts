/**
 * What an order comes to: lines, discount, tax, total (PLR-159).
 *
 * Done in exact decimals and rounded once per figure, so a basket of 10-cent items or a half-cent of tax
 * cannot drift by a cent the way a running float sum does.
 */
import { money, percentOf, roundMoney, sum, type Decimal } from './money'

export type OrderTotals = {
  /** Lines before any discount. */
  linesTotal: Decimal
  /** The discount actually taken (never more than the lines). */
  discountAmount: Decimal
  /** Lines less discount: what tax is charged on. */
  subtotal: Decimal
  taxAmount: Decimal
  totalAmount: Decimal
}

/** A price or quantity arriving as a JS number: take the shortest decimal for it, so no float noise comes along. */
const exact = (n: number) => money(String(n))

export function orderTotals(
  lines: ReadonlyArray<{ quantity: number; unitPrice: number }>,
  opts: { discount?: number; taxRate: number },
): OrderTotals {
  const linesTotal = roundMoney(sum(lines.map((l) => exact(l.unitPrice).times(l.quantity))))
  const requested = opts.discount && opts.discount > 0 ? roundMoney(exact(opts.discount)) : money('0')
  const discountAmount = requested.gt(linesTotal) ? linesTotal : requested
  const subtotal = linesTotal.minus(discountAmount)
  const taxAmount = subtotal.lte(0) ? money('0') : percentOf(subtotal, String(opts.taxRate))
  return { linesTotal, discountAmount, subtotal, taxAmount, totalAmount: subtotal.plus(taxAmount) }
}

/** What is left to pay after a gift card (never negative). */
export function remainingAfterGiftCard(total: Decimal, giftCardBalance: number | undefined): { applied: Decimal; remaining: Decimal } {
  const balance = giftCardBalance && giftCardBalance > 0 ? roundMoney(exact(giftCardBalance)) : money('0')
  const applied = balance.gt(total) ? total : balance
  return { applied, remaining: total.minus(applied) }
}
