import * as crm from './crm'
import { ADMIN_ROLES, ApiError, type SessionUser } from './session'

/** B2B portal buyers — not warehouse, driver, or admin staff. */
export const PORTAL_BUYER_ROLES = ['STAFF', 'VIEWER'] as const

export function isPortalBuyer(role: string): boolean {
  return (PORTAL_BUYER_ROLES as readonly string[]).includes(role)
}

export function isAdminStaff(role: string): boolean {
  return (ADMIN_ROLES as readonly string[]).includes(role)
}

export async function resolvePortalCustomerId(tenantId: string, email: string): Promise<string | null> {
  const customer = await crm.findCustomerByEmail(tenantId, email.trim())
  return customer?.id ?? null
}

export async function requirePortalCustomerId(session: SessionUser): Promise<string> {
  const customerId = await resolvePortalCustomerId(session.tenantId, session.email)
  if (!customerId) {
    throw new ApiError(
      403,
      'No customer account is linked to this user. Ask your administrator to add a CRM customer with your email.',
    )
  }
  return customerId
}

export async function getAuthProfile(session: SessionUser) {
  const customer = await crm.findCustomerByEmail(session.tenantId, session.email)
  const { permissionsForRole } = await import('./permissions')
  const featureFlags = await import('./feature-flags')
  const { tenantDb } = await import('./db')
  const permissions =
    Array.isArray(session.permissions) && session.permissions.length > 0
      ? session.permissions
      : permissionsForRole(session.role)
  const [effective, org] = await Promise.all([
    featureFlags.getTenantFeatures(session.tenantId),
    tenantDb.tenantOrganization.findUnique({
      where: { id: session.tenantId },
      select: { onboardingPhase: true },
    }),
  ])
  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
    tenantId: session.tenantId,
    permissions,
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    isPortalBuyer: isPortalBuyer(session.role),
    onboardingPhase: org?.onboardingPhase ?? 'READY',
    navFeatures: {
      marketplace: effective.marketplace === true,
      celestial: effective.celestial === true,
    },
  }
}
