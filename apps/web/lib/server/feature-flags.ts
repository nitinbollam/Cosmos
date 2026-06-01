import { tenantDb } from './db'

export type TenantFeatures = {
  pos?: boolean
  quotes?: boolean
  contractPricing?: boolean
  wavePicking?: boolean
  splitShipments?: boolean
  advancedTax?: boolean
}

const PLAN_DEFAULTS: Record<string, TenantFeatures> = {
  STARTER: { quotes: true, contractPricing: false, pos: false, wavePicking: false, splitShipments: false, advancedTax: false },
  GROWTH: { quotes: true, contractPricing: true, pos: true, wavePicking: true, splitShipments: true, advancedTax: true },
  ENTERPRISE: { quotes: true, contractPricing: true, pos: true, wavePicking: true, splitShipments: true, advancedTax: true },
}

export async function getTenantFeatures(tenantId: string): Promise<TenantFeatures> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) return PLAN_DEFAULTS.STARTER
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const overrides = (settings.features ?? {}) as TenantFeatures
  const planDefaults = PLAN_DEFAULTS[org.plan] ?? PLAN_DEFAULTS.STARTER
  return { ...planDefaults, ...overrides }
}

export async function assertFeature(tenantId: string, feature: keyof TenantFeatures) {
  const features = await getTenantFeatures(tenantId)
  if (!features[feature]) {
    const { ApiError } = await import('./session')
    throw new ApiError(403, `Feature "${feature}" is not enabled on your plan`)
  }
}
