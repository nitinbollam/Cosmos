import { money, roundMoney } from './money'

export type InvoiceDisplayStatus = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'CREDITED' | 'OVERDUE'

/** What is still owed, in whole cents and never below zero. Worked in Decimal so cent balances are exact. */
export function invoiceBalance(total: number, paid: number, credited: number): number {
  const owed = roundMoney(money(String(total)).minus(String(paid)).minus(String(credited)))
  return owed.isNegative() ? 0 : owed.toNumber()
}

export function deriveInvoiceStatus(input: {
  orderStatus?: string
  totalAmount: number
  amountPaid: number
  amountCredited: number
  paymentMethod?: string
  issuedAt?: Date | string
}): InvoiceDisplayStatus {
  if (input.orderStatus === 'CANCELLED' || input.orderStatus === 'FAILED') return 'VOID'
  const balance = invoiceBalance(input.totalAmount, input.amountPaid, input.amountCredited)
  // Exact to the cent: one cent still owed is unpaid, and one cent paid is a partial payment.
  if (balance <= 0 && input.amountCredited > 0) return 'CREDITED'
  if (balance <= 0) return 'PAID'
  if (input.amountPaid > 0) return 'PARTIALLY_PAID'
  if (input.paymentMethod === 'NET_TERMS' && input.issuedAt) {
    const issued = new Date(input.issuedAt).getTime()
    const days = (Date.now() - issued) / 86400000
    if (days > 30) return 'OVERDUE'
  }
  return 'ISSUED'
}

export function formatInvoiceNumber(orderId: string): string {
  return `INV-${orderId.slice(-8).toUpperCase()}`
}

export function formatCreditMemoNumber(orderId: string, sequence: number): string {
  return `CM-${orderId.slice(-6).toUpperCase()}-${sequence}`
}

export function toStoredInvoiceStatus(status: InvoiceDisplayStatus): Exclude<InvoiceDisplayStatus, 'OVERDUE'> {
  return status === 'OVERDUE' ? 'ISSUED' : status
}
