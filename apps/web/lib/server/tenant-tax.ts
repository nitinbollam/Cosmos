import { tenantDb } from './db'
import { ApiError } from './session'

/**
 * Tenant sales tax configuration (PLR-154).
 *
 * There is deliberately NO fallback rate. A tenant must have an explicit, valid rate before any order,
 * quote or POS sale can be priced; a silent default hides misconfiguration and bills wrong tax.
 * Stored in TenantOrganization.settings: `salesTaxRate` (decimal 0..1, e.g. 0.07 for 7%) and
 * `salesTaxConfirmedAt` (ISO date set when an admin saves the rate; null for migrated rates that an
 * admin has not yet confirmed).
 */

export type TaxConfigStatus = 'configured' | 'unconfirmed' | 'missing' | 'invalid'

export type TenantTaxConfig = {
  status: TaxConfigStatus
  /** Decimal rate (0..1) when status is configured/unconfirmed, otherwise null. */
  rate: number | null
  confirmedAt: string | null
}

export const TAX_NOT_CONFIGURED_MESSAGE =
  'Sales tax is not configured for this organisation. Set the sales tax rate in Settings → Company → Sales tax.'

function settingsOf(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

/** Pure classification of a tenant's stored settings (exported for tests and the backfill). */
export function classifyTaxSettings(rawSettings: unknown): TenantTaxConfig {
  const s = settingsOf(rawSettings)
  const rate = s.salesTaxRate
  const confirmedAt = typeof s.salesTaxConfirmedAt === 'string' ? s.salesTaxConfirmedAt : null
  if (rate === undefined || rate === null) return { status: 'missing', rate: null, confirmedAt: null }
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return { status: 'invalid', rate: null, confirmedAt }
  }
  return { status: confirmedAt ? 'configured' : 'unconfirmed', rate, confirmedAt }
}

export async function getTenantTaxConfig(tenantId: string): Promise<TenantTaxConfig> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  return classifyTaxSettings(org?.settings)
}

/** The rate to price with. Throws 422 (never defaults) when the tenant has no usable rate. */
export async function getTenantSalesTaxRate(tenantId: string): Promise<number> {
  const cfg = await getTenantTaxConfig(tenantId)
  if (cfg.rate === null) throw new ApiError(422, TAX_NOT_CONFIGURED_MESSAGE)
  return cfg.rate
}

export async function getTenantTaxSettings(tenantId: string) {
  const cfg = await getTenantTaxConfig(tenantId)
  return {
    status: cfg.status,
    confirmedAt: cfg.confirmedAt,
    salesTaxRate: cfg.rate,
    salesTaxPercent: cfg.rate === null ? null : Math.round(cfg.rate * 10000) / 100,
  }
}

/** Validates an admin-supplied rate. A percent entered as a decimal-rate (7 instead of 0.07) is rejected. */
export function assertValidSalesTaxRate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ApiError(400, 'salesTaxRate must be a number expressed as a decimal, e.g. 0.07 for 7%')
  }
  if (value < 0 || value > 0.5) {
    throw new ApiError(
      400,
      `salesTaxRate ${value} is out of range. Enter a decimal between 0 and 0.5 (0.07 means 7%, not 7).`,
    )
  }
  return value
}

export async function updateTenantSalesTaxRate(tenantId: string, salesTaxRate: unknown) {
  const rate = assertValidSalesTaxRate(salesTaxRate)
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new ApiError(404, 'Organisation not found')
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { settings: { ...settingsOf(org.settings), salesTaxRate: rate, salesTaxConfirmedAt: new Date().toISOString() } },
  })
  return getTenantTaxSettings(tenantId)
}
