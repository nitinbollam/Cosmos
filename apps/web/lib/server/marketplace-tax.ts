import { computeOrderTax } from './compliance-tax'
import { inventoryDb } from './db'

/** Marketplace facilitator tax — uses buyer ship-to state when available, else tenant rate. */
export async function computeMarketplaceOrderTaxCents(
  buyerTenantId: string,
  merchandiseSubtotalCents: number,
): Promise<{ taxAmountCents: number; taxRate: number; taxJurisdiction: string }> {
  const subtotalDollars = merchandiseSubtotalCents / 100
  if (subtotalDollars <= 0) {
    return { taxAmountCents: 0, taxRate: 0, taxJurisdiction: 'NONE' }
  }

  const wh = await inventoryDb.warehouse.findFirst({
    where: { tenantId: buyerTenantId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  })
  const shipToState =
    wh?.address && typeof wh.address === 'object'
      ? String((wh.address as Record<string, unknown>).state ?? '').trim() || null
      : null

  const { taxAmount, rate, jurisdiction } = await computeOrderTax(buyerTenantId, subtotalDollars, shipToState)
  return {
    taxAmountCents: Math.round(taxAmount * 100),
    taxRate: rate,
    taxJurisdiction: jurisdiction,
  }
}

export async function buildMarketplaceOrderPricing(
  buyerTenantId: string,
  unitPriceCents: number,
  quantity: number,
) {
  const merchandiseSubtotalCents = unitPriceCents * quantity
  const tax = await computeMarketplaceOrderTaxCents(buyerTenantId, merchandiseSubtotalCents)
  return {
    merchandiseSubtotalCents,
    taxAmountCents: tax.taxAmountCents,
    taxRate: tax.taxRate,
    taxJurisdiction: tax.taxJurisdiction,
    agreedPriceCents: merchandiseSubtotalCents + tax.taxAmountCents,
  }
}
