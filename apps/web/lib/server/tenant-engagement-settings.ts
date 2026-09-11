import { tenantDb } from './db'
import { getTenantWorkflowSettings, updateTenantWorkflowSettings } from './tenant-workflow-settings'

export type TenantEngagementSettings = {
  loyaltyPointsPerDollar: number
  loyaltyPointsToDollarRate: number
}

const LOYALTY_DEFAULTS: TenantEngagementSettings = {
  loyaltyPointsPerDollar: 1,
  loyaltyPointsToDollarRate: 0.01,
}

function parseSettings(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

export async function getTenantEngagementSettings(tenantId: string) {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  const s = parseSettings(org?.settings)
  const loyaltyPointsPerDollar =
    typeof s.loyaltyPointsPerDollar === 'number' && s.loyaltyPointsPerDollar >= 0
      ? s.loyaltyPointsPerDollar
      : LOYALTY_DEFAULTS.loyaltyPointsPerDollar
  const loyaltyPointsToDollarRate =
    typeof s.loyaltyPointsToDollarRate === 'number' && s.loyaltyPointsToDollarRate > 0
      ? s.loyaltyPointsToDollarRate
      : LOYALTY_DEFAULTS.loyaltyPointsToDollarRate
  const workflow = await getTenantWorkflowSettings(tenantId)
  return { ...workflow, loyaltyPointsPerDollar, loyaltyPointsToDollarRate }
}

export async function updateTenantEngagementSettings(
  tenantId: string,
  patch: Partial<{
    poApprovalThreshold: number
    discountApprovalThresholdPct: number
    loyaltyPointsPerDollar: number
    loyaltyPointsToDollarRate: number
  }>,
) {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new Error('Tenant not found')
  const current = parseSettings(org.settings)
  const next = {
    ...current,
    ...(patch.poApprovalThreshold !== undefined ? { poApprovalThreshold: patch.poApprovalThreshold } : {}),
    ...(patch.discountApprovalThresholdPct !== undefined
      ? { discountApprovalThresholdPct: patch.discountApprovalThresholdPct }
      : {}),
    ...(patch.loyaltyPointsPerDollar !== undefined
      ? { loyaltyPointsPerDollar: patch.loyaltyPointsPerDollar }
      : {}),
    ...(patch.loyaltyPointsToDollarRate !== undefined
      ? { loyaltyPointsToDollarRate: patch.loyaltyPointsToDollarRate }
      : {}),
  }
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { settings: next as never },
  })
  if (patch.poApprovalThreshold !== undefined || patch.discountApprovalThresholdPct !== undefined) {
    await updateTenantWorkflowSettings(tenantId, {
      poApprovalThreshold: patch.poApprovalThreshold,
      discountApprovalThresholdPct: patch.discountApprovalThresholdPct,
    })
  }
  return getTenantEngagementSettings(tenantId)
}
