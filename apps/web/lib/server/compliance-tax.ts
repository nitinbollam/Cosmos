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

/** Stub: computes 7% tax without event bus (matches legacy Nest behavior). */
export async function recordTax(_tenantId: string, body: RecordTaxInput) {
  const total = body.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0)
  const taxAmount = +(total * 0.07).toFixed(2)
  return { recorded: true, taxAmount }
}
