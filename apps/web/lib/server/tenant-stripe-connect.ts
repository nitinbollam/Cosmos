import { tenantDb } from './db'
import { ApiError } from './session'
import type { StripeConnectContext } from './stripe-context'

export type TenantStripeConnectState = {
  stripeConnectedAccountId: string | null
  stripeChargesEnabled: boolean
  stripePayoutsEnabled: boolean
  stripeDetailsSubmitted: boolean
}

export type StripeConnectOnboardingStatus =
  | 'not_started'
  | 'pending'
  | 'restricted'
  | 'ready'

export function deriveConnectOnboardingStatus(org: TenantStripeConnectState): StripeConnectOnboardingStatus {
  if (!org.stripeConnectedAccountId) return 'not_started'
  if (org.stripeChargesEnabled) return 'ready'
  if (org.stripeDetailsSubmitted) return 'restricted'
  return 'pending'
}

export async function getTenantStripeConnectState(tenantId: string): Promise<TenantStripeConnectState> {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new ApiError(404, 'Tenant organization not found')
  return {
    stripeConnectedAccountId: org.stripeConnectedAccountId ?? null,
    stripeChargesEnabled: org.stripeChargesEnabled,
    stripePayoutsEnabled: org.stripePayoutsEnabled,
    stripeDetailsSubmitted: org.stripeDetailsSubmitted,
  }
}

export async function findTenantIdByConnectedAccount(accountId: string): Promise<string | null> {
  const org = await tenantDb.tenantOrganization.findFirst({
    where: { stripeConnectedAccountId: accountId },
    select: { id: true },
  })
  return org?.id ?? null
}

export async function updateTenantFromStripeAccount(
  accountId: string,
  patch: Partial<{
    chargesEnabled: boolean
    payoutsEnabled: boolean
    detailsSubmitted: boolean
  }>,
) {
  const org = await tenantDb.tenantOrganization.findFirst({ where: { stripeConnectedAccountId: accountId } })
  if (!org) return null
  return tenantDb.tenantOrganization.update({
    where: { id: org.id },
    data: {
      ...(patch.chargesEnabled !== undefined ? { stripeChargesEnabled: patch.chargesEnabled } : {}),
      ...(patch.payoutsEnabled !== undefined ? { stripePayoutsEnabled: patch.payoutsEnabled } : {}),
      ...(patch.detailsSubmitted !== undefined ? { stripeDetailsSubmitted: patch.detailsSubmitted } : {}),
    },
  })
}

import { isStripeConfigured } from './stripe'

/** Require Connect account with charges enabled before collecting card/ACH payments. */
export async function requireStripeConnectContext(tenantId: string): Promise<StripeConnectContext> {
  const org = await getTenantStripeConnectState(tenantId)
  if (org.stripeConnectedAccountId && org.stripeChargesEnabled) {
    return { connectedAccountId: org.stripeConnectedAccountId, tenantId }
  }
  // When standard Stripe is configured (STRIPE_SECRET_KEY set) and no Connect account exists, allow direct charge
  if (isStripeConfigured() && !org.stripeConnectedAccountId) {
    return { connectedAccountId: '', tenantId }
  }
  if (!org.stripeConnectedAccountId) {
    throw new ApiError(
      402,
      'This distributor has not connected Stripe. Complete Connect onboarding in Settings → Integrations.',
    )
  }
  if (!org.stripeChargesEnabled) {
    throw new ApiError(
      402,
      'Stripe charges are not enabled for this distributor. Finish Connect onboarding or resolve restrictions in Stripe.',
    )
  }
  return { connectedAccountId: org.stripeConnectedAccountId, tenantId }
}

/** Load Connect context when account exists (e.g. status UI); does not require charges enabled. */
export async function optionalStripeConnectContext(tenantId: string): Promise<StripeConnectContext | null> {
  const org = await getTenantStripeConnectState(tenantId)
  if (!org.stripeConnectedAccountId) return null
  return { connectedAccountId: org.stripeConnectedAccountId, tenantId }
}
