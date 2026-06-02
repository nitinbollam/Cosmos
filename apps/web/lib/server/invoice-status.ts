export type InvoiceDisplayStatus = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'CREDITED' | 'OVERDUE'

export function invoiceBalance(total: number, paid: number, credited: number): number {
  return Math.max(0, +(total - paid - credited).toFixed(2))
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
  if (balance <= 0.01 && input.amountCredited > 0.01) return 'CREDITED'
  if (balance <= 0.01) return 'PAID'
  if (input.amountPaid > 0.01) return 'PARTIALLY_PAID'
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
