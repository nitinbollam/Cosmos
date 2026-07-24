import { tenantDb } from './db'

const DEFAULT_SALES_TAX_RATE = 0.07

export async function getTenantSalesTaxRate(tenantId: string): Promise<number> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org?.settings || typeof org.settings !== 'object' || Array.isArray(org.settings)) {
    return DEFAULT_SALES_TAX_RATE
  }
  const rate = (org.settings as Record<string, unknown>).salesTaxRate
  if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1) {
    return rate
  }
  return DEFAULT_SALES_TAX_RATE
}

export async function getTenantTaxSettings(tenantId: string) {
  const rate = await getTenantSalesTaxRate(tenantId)
  return { salesTaxRate: rate, salesTaxPercent: +(rate * 100).toFixed(2) }
}

export async function updateTenantSalesTaxRate(tenantId: string, salesTaxRate: number) {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  const settings =
    org?.settings && typeof org.settings === 'object' && !Array.isArray(org.settings)
      ? (org.settings as Record<string, unknown>)
      : {}
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { settings: { ...settings, salesTaxRate } },
  })
  return getTenantTaxSettings(tenantId)
}
