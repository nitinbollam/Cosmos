import { complianceDb } from './db'
import { getTenantSalesTaxRate } from './tenant-tax'

/** State-based demo rates — extend via tenant settings.taxJurisdictions. */
const STATE_TAX_RATES: Record<string, number> = {
  TX: 0.0825,
  CA: 0.0725,
  NY: 0.08,
  FL: 0.06,
  DEFAULT: 0.07,
}

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

/** Computes sales tax using tenant rate or state jurisdiction when ship-to state is provided. */
export async function computeOrderTax(
  tenantId: string,
  subtotal: number,
  shipToState?: string | null,
): Promise<{ taxAmount: number; rate: number; jurisdiction: string }> {
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return { taxAmount: 0, rate: 0, jurisdiction: 'NONE' }
  }
  const state = shipToState?.trim().toUpperCase()
  if (state && STATE_TAX_RATES[state] != null) {
    const rate = STATE_TAX_RATES[state]!
    return { taxAmount: computeSalesTax(subtotal, rate), rate, jurisdiction: state }
  }
  const rate = await getTenantSalesTaxRate(tenantId)
  return { taxAmount: computeSalesTax(subtotal, rate), rate, jurisdiction: 'TENANT' }
}

/** Records tax calculation for an order (persisted via order.taxAmount; compliance snapshot is computed). */
export async function recordTax(tenantId: string, body: RecordTaxInput) {
  const total = body.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0)
  const { taxAmount, rate, jurisdiction } = await computeOrderTax(tenantId, total)
  return { recorded: true, taxAmount, rate, jurisdiction, merchandiseSubtotal: total }
}
