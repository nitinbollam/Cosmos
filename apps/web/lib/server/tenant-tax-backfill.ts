import { orderDb, tenantDb } from './db'
import { classifyTaxSettings, type TaxConfigStatus } from './tenant-tax'

/**
 * PLR-154 migration. Until this ticket, tenants without a usable rate were silently billed at 7%.
 * To keep every existing tenant's order totals unchanged on release day, those tenants get that
 * effective rate written explicitly, WITHOUT a confirmation date, so the admin UI shows a banner asking
 * them to confirm or correct it. Idempotent: tenants that already have a valid rate are untouched.
 */
// tax-rate-allowlist: the historical effective rate being made explicit, used only by this migration.
const LEGACY_EFFECTIVE_RATE = 0.07

export type TaxBackfillRow = {
  tenantId: string
  slug: string
  previousStatus: TaxConfigStatus
  previousValue: unknown
  invoicesAtLegacyRate: number
  taxBilledAtLegacyRate: number
  applied: boolean
}

export async function backfillTenantSalesTax(opts: { dryRun: boolean }): Promise<TaxBackfillRow[]> {
  const orgs = await tenantDb.tenantOrganization.findMany()
  const rows: TaxBackfillRow[] = []
  for (const org of orgs) {
    const cfg = classifyTaxSettings(org.settings)
    if (cfg.status === 'configured' || cfg.status === 'unconfirmed') continue

    const settings =
      org.settings && typeof org.settings === 'object' && !Array.isArray(org.settings)
        ? (org.settings as Record<string, unknown>)
        : {}
    const impact = await orderDb.invoice.aggregate({
      where: { tenantId: org.id },
      _count: true,
      _sum: { taxAmount: true },
    })
    if (!opts.dryRun) {
      await tenantDb.tenantOrganization.update({
        where: { id: org.id },
        data: { settings: { ...settings, salesTaxRate: LEGACY_EFFECTIVE_RATE, salesTaxConfirmedAt: null } },
      })
    }
    rows.push({
      tenantId: org.id,
      slug: org.slug,
      previousStatus: cfg.status,
      previousValue: settings.salesTaxRate ?? null,
      invoicesAtLegacyRate: impact._count,
      taxBilledAtLegacyRate: Number(impact._sum.taxAmount ?? 0),
      applied: !opts.dryRun,
    })
  }
  return rows
}
