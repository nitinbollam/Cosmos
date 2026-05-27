import { complianceDb } from './db'

export async function taxSummary(tenantId: string) {
  const liabilities = await complianceDb.mSATransaction.aggregate({
    where: { tenantId },
    _sum: { netAmount: true },
    _count: true,
  })
  return { totalNet: liabilities._sum.netAmount ?? 0, count: liabilities._count }
}

export type RecordTaxInput = {
  orderId: string
  customerId: string
  lineItems: Array<{ skuId: string; quantity: number; unitPrice: number; warehouseId: string }>
  correlationId: string
}

const DEFAULT_TAX_RATE = 0.07

/** Standard sales tax on merchandise subtotal (7% demo rate). */
export function computeSalesTax(subtotal: number, rate = DEFAULT_TAX_RATE): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0
  return +(subtotal * rate).toFixed(2)
}

/** Stub: computes 7% tax without event bus (matches legacy Nest behavior). */
export async function recordTax(_tenantId: string, body: RecordTaxInput) {
  const total = body.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0)
  const taxAmount = computeSalesTax(total)
  return { recorded: true, taxAmount }
}
