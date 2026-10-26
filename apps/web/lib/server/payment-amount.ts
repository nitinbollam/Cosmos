import { formatMoney, money, type Decimal, type MoneyValue } from './money'
import { ApiError } from './session'

// A plain decimal: optional minus, digits, optional fraction. No exponents, units or trailing text.
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/

/**
 * Reads a payment amount from a request body: a JSON number, or a decimal string such as "51.04".
 * Rejects anything else ("10abc", "", null, NaN, Infinity), amounts that are not above zero, and
 * amounts with more than two decimal places. Nothing is rounded: the amount applied is the amount
 * entered, or the request fails.
 */
export function parsePaymentAmount(raw: unknown): Decimal {
  let amount: Decimal
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // The shortest decimal string for the float, so 0.1 arrives as 0.1 rather than 0.1000000000000000055.
    amount = money(String(raw))
  } else if (typeof raw === 'string' && DECIMAL_STRING.test(raw.trim())) {
    amount = money(raw.trim())
  } else {
    throw new ApiError(400, 'Payment amount must be a number, such as 25 or 25.50')
  }
  if (!amount.gt(0)) throw new ApiError(400, 'Payment amount must be greater than zero')
  if (amount.decimalPlaces() > 2) throw new ApiError(400, 'Payment amount can have at most 2 decimal places')
  return amount
}

/** What is still owed on an invoice, exactly: total less paid and credited, never below zero. */
export function invoiceRemaining(invoice: { totalAmount: MoneyValue; amountPaid: MoneyValue; amountCredited: MoneyValue }): Decimal {
  const remaining = money(invoice.totalAmount).minus(invoice.amountPaid).minus(invoice.amountCredited)
  return remaining.isNegative() ? money('0') : remaining
}

/** Rejects a payment larger than what is still owed. There is no overpayment credit to put the rest in. */
export function assertWithinBalance(amount: Decimal, balance: Decimal): void {
  if (amount.gt(balance)) {
    throw new ApiError(
      400,
      `Payment of $${formatMoney(amount)} is more than the remaining balance of $${formatMoney(balance)}`,
    )
  }
}
