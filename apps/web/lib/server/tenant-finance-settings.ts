import { tenantDb } from './db'
import { ApiError } from './session'

export type TenantFinanceSettings = {
  baseCurrency: string
  expenseApprovalThreshold: number
}

const DEFAULTS: TenantFinanceSettings = {
  baseCurrency: 'USD',
  expenseApprovalThreshold: 500,
}

function parseSettings(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

export async function getTenantFinanceSettings(tenantId: string): Promise<TenantFinanceSettings> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  const s = parseSettings(org?.settings)
  const baseCurrency =
    typeof s.baseCurrency === 'string' && /^[A-Z]{3}$/.test(s.baseCurrency)
      ? s.baseCurrency
      : DEFAULTS.baseCurrency
  const expenseApprovalThreshold =
    typeof s.expenseApprovalThreshold === 'number' && s.expenseApprovalThreshold >= 0
      ? s.expenseApprovalThreshold
      : DEFAULTS.expenseApprovalThreshold
  return { baseCurrency, expenseApprovalThreshold }
}

export async function updateTenantFinanceSettings(
  tenantId: string,
  patch: Partial<TenantFinanceSettings>,
): Promise<TenantFinanceSettings> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new ApiError(404, 'Tenant not found')
  const current = parseSettings(org.settings)
  if (patch.baseCurrency !== undefined && current.baseCurrency && patch.baseCurrency !== current.baseCurrency) {
    throw new ApiError(400, 'Base currency cannot be changed after it has been set')
  }
  const next = {
    ...current,
    ...(patch.baseCurrency !== undefined ? { baseCurrency: patch.baseCurrency.toUpperCase() } : {}),
    ...(patch.expenseApprovalThreshold !== undefined
      ? { expenseApprovalThreshold: patch.expenseApprovalThreshold }
      : {}),
  }
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { settings: next as never },
  })
  return getTenantFinanceSettings(tenantId)
}
