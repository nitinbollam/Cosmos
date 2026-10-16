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

/**
 * The portal users who sign in as this customer: active buyer accounts in the tenant whose email
 * the portal resolves to this very customer (the same lookup as requirePortalCustomerId). Staff
 * who share the email, or buyers whose email resolves to another customer, are left out.
 */
export async function portalUsersForCustomer(tenantId: string, customerId: string) {
  let email: string | null | undefined
  try {
    email = (await crm.getCustomer(tenantId, customerId)).email?.trim()
  } catch {
    return []
  }
  if (!email) return []
  const { authDb } = await import('./db')
  const users = await authDb.user.findMany({
    where: { tenantId, email: email.toLowerCase(), isActive: true },
    select: { id: true, email: true, role: true },
  })
  const matches = []
  for (const user of users) {
    if (!isPortalBuyer(user.role)) continue
    if ((await resolvePortalCustomerId(tenantId, user.email)) === customerId) matches.push(user)
  }
  return matches
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
