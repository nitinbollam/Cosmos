import { tenantDb } from './db'

export type TenantFeatures = {
  pos?: boolean
  quotes?: boolean
  contractPricing?: boolean
  wavePicking?: boolean
  splitShipments?: boolean
  advancedTax?: boolean
  celestial?: boolean
  marketplace?: boolean
}

const PLAN_DEFAULTS: Record<string, TenantFeatures> = {
  STARTER: { quotes: true, contractPricing: false, pos: false, wavePicking: false, splitShipments: false, advancedTax: false, celestial: false, marketplace: true },
  GROWTH: { quotes: true, contractPricing: true, pos: true, wavePicking: true, splitShipments: true, advancedTax: true, celestial: true, marketplace: true },
  ENTERPRISE: { quotes: true, contractPricing: true, pos: true, wavePicking: true, splitShipments: true, advancedTax: true, celestial: true, marketplace: true },
}

export type TenantFeaturesDetail = {
  plan: string
  defaults: TenantFeatures
  overrides: TenantFeatures
  effective: TenantFeatures
}

export async function getTenantFeaturesDetail(tenantId: string): Promise<TenantFeaturesDetail> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) {
    return {
      plan: 'STARTER',
      defaults: PLAN_DEFAULTS.STARTER,
      overrides: {},
      effective: PLAN_DEFAULTS.STARTER,
    }
  }
  const settings = (org.settings ?? {}) as Record<string, unknown>
  const overrides = (settings.features ?? {}) as TenantFeatures
  const defaults = PLAN_DEFAULTS[org.plan] ?? PLAN_DEFAULTS.STARTER
  return { plan: org.plan, defaults, overrides, effective: { ...defaults, ...overrides } }
}

export async function getTenantFeatures(tenantId: string): Promise<TenantFeatures> {
  const detail = await getTenantFeaturesDetail(tenantId)
  return detail.effective
}

export async function assertFeature(tenantId: string, feature: keyof TenantFeatures) {
  const features = await getTenantFeatures(tenantId)
  if (!features[feature]) {
    const { ApiError } = await import('./session')
    throw new ApiError(403, `Feature "${feature}" is not enabled on your plan`)
  }
}
