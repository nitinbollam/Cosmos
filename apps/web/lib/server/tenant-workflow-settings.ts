import { tenantDb } from './db'

export type TenantWorkflowSettings = {
  poApprovalThreshold: number
  discountApprovalThresholdPct: number
  /** A driver may not take more than this (pre-tax) off an order at the door without a manager. 0 = no limit. */
  doorAdjustmentThreshold: number
}

const DEFAULTS: TenantWorkflowSettings = {
  poApprovalThreshold: 2500,
  discountApprovalThresholdPct: 15,
  doorAdjustmentThreshold: 0,
}

function parseSettings(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

export async function getTenantWorkflowSettings(tenantId: string): Promise<TenantWorkflowSettings> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  const s = parseSettings(org?.settings)
  const poApprovalThreshold =
    typeof s.poApprovalThreshold === 'number' && s.poApprovalThreshold >= 0
      ? s.poApprovalThreshold
      : DEFAULTS.poApprovalThreshold
  const discountApprovalThresholdPct =
    typeof s.discountApprovalThresholdPct === 'number' &&
    s.discountApprovalThresholdPct >= 0 &&
    s.discountApprovalThresholdPct <= 100
      ? s.discountApprovalThresholdPct
      : DEFAULTS.discountApprovalThresholdPct
  const doorAdjustmentThreshold =
    typeof s.doorAdjustmentThreshold === 'number' && s.doorAdjustmentThreshold >= 0
      ? s.doorAdjustmentThreshold
      : DEFAULTS.doorAdjustmentThreshold
  return { poApprovalThreshold, discountApprovalThresholdPct, doorAdjustmentThreshold }
}

export async function updateTenantWorkflowSettings(
  tenantId: string,
  patch: Partial<TenantWorkflowSettings>,
): Promise<TenantWorkflowSettings> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new Error('Tenant not found')
  const current = parseSettings(org.settings)
  const next = {
    ...current,
    ...(patch.poApprovalThreshold !== undefined ? { poApprovalThreshold: patch.poApprovalThreshold } : {}),
    ...(patch.discountApprovalThresholdPct !== undefined
      ? { discountApprovalThresholdPct: patch.discountApprovalThresholdPct }
      : {}),
    ...(patch.doorAdjustmentThreshold !== undefined ? { doorAdjustmentThreshold: patch.doorAdjustmentThreshold } : {}),
  }
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { settings: next as never },
  })
  return getTenantWorkflowSettings(tenantId)
}
