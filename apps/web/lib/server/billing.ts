import Stripe from 'stripe'
import { tenantDb } from './db'
import { ApiError } from './session'

export type TenantPlan = 'STARTER' | 'GROWTH' | 'ENTERPRISE'

const PLAN_RANK: Record<TenantPlan, number> = { STARTER: 0, GROWTH: 1, ENTERPRISE: 2 }

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) throw new ApiError(503, 'Billing is not configured (STRIPE_SECRET_KEY missing)')
  return new Stripe(key, { apiVersion: '2024-06-20', telemetry: false })
}

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

function appUrl(): string {
  return process.env.APP_URL?.trim() || 'http://localhost:4000'
}

function priceIdForPlan(plan: TenantPlan): string | null {
  if (plan === 'GROWTH') return process.env.STRIPE_PRICE_GROWTH?.trim() || null
  if (plan === 'ENTERPRISE') return process.env.STRIPE_PRICE_ENTERPRISE?.trim() || null
  return null
}

export function planFromPriceId(priceId: string): TenantPlan | null {
  if (priceId === process.env.STRIPE_PRICE_GROWTH?.trim()) return 'GROWTH'
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE?.trim()) return 'ENTERPRISE'
  return null
}

async function ensureOrg(tenantId: string) {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new ApiError(404, 'Tenant organization not found')
  return org
}

async function ensureStripeCustomer(tenantId: string, email: string): Promise<string> {
  const org = await ensureOrg(tenantId)
  if (org.stripeCustomerId) return org.stripeCustomerId

  const stripe = stripeClient()
  const customer = await stripe.customers.create({
    email,
    name: org.displayName,
    metadata: { tenantId },
  })
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { stripeCustomerId: customer.id },
  })
  return customer.id
}

export async function getBillingStatus(tenantId: string) {
  const org = await ensureOrg(tenantId)
  return {
    plan: org.plan,
    billingStatus: org.billingStatus,
    stripeCustomerId: org.stripeCustomerId,
    stripeSubscriptionId: org.stripeSubscriptionId,
    billingConfigured: isBillingConfigured(),
    pricesConfigured: {
      growth: Boolean(process.env.STRIPE_PRICE_GROWTH?.trim()),
      enterprise: Boolean(process.env.STRIPE_PRICE_ENTERPRISE?.trim()),
    },
  }
}

/** Paid upgrades go through Stripe Checkout; STARTER is free. */
export async function createCheckoutSession(
  tenantId: string,
  plan: TenantPlan,
  billingEmail: string,
): Promise<{ url: string }> {
  if (plan === 'STARTER') throw new ApiError(400, 'Starter is free — use the billing portal to cancel a paid plan')
  const priceId = priceIdForPlan(plan)
  if (!priceId) throw new ApiError(503, `Stripe price not configured for ${plan}`)

  const org = await ensureOrg(tenantId)
  if (PLAN_RANK[org.plan] >= PLAN_RANK[plan] && org.billingStatus === 'active') {
    throw new ApiError(400, 'You are already on this plan or higher — manage your subscription in the billing portal')
  }

  const customerId = await ensureStripeCustomer(tenantId, billingEmail)
  const stripe = stripeClient()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl()}/admin/settings?tab=billing&checkout=success`,
    cancel_url: `${appUrl()}/admin/settings?tab=billing&checkout=cancel`,
    metadata: { tenantId, plan },
    subscription_data: { metadata: { tenantId, plan } },
    allow_promotion_codes: true,
  })
  if (!session.url) throw new ApiError(500, 'Stripe did not return a checkout URL')
  return { url: session.url }
}

/** Manage payment method, cancel, or change plan via Stripe Customer Portal. */
export async function createPortalSession(tenantId: string, billingEmail: string): Promise<{ url: string }> {
  const customerId = await ensureStripeCustomer(tenantId, billingEmail)
  const stripe = stripeClient()
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/admin/settings?tab=billing`,
  })
  return { url: session.url }
}

export async function applyPlanFromSubscription(
  tenantId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const priceId = subscription.items.data[0]?.price?.id
  const metaPlan = subscription.metadata?.plan as TenantPlan | undefined
  const plan = (priceId ? planFromPriceId(priceId) : null) ?? metaPlan ?? 'STARTER'

  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: {
      plan,
      stripeSubscriptionId: subscription.id,
      billingStatus: subscription.status,
    },
  })

  const { authDb } = await import('./db')
  await authDb.tenant.update({ where: { id: tenantId }, data: { plan } }).catch(() => undefined)
}

export async function downgradeToStarter(tenantId: string): Promise<void> {
  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { plan: 'STARTER', stripeSubscriptionId: null, billingStatus: 'canceled' },
  })
  const { authDb } = await import('./db')
  await authDb.tenant.update({ where: { id: tenantId }, data: { plan: 'STARTER' } }).catch(() => undefined)
}

/** Process Stripe Billing webhook events (subscription lifecycle). */
export async function handleBillingWebhookEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const tenantId = session.metadata?.tenantId
      const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      if (!tenantId || !subId) return true
      const stripe = stripeClient()
      const sub = await stripe.subscriptions.retrieve(subId)
      await applyPlanFromSubscription(tenantId, sub)
      return true
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const tenantId = sub.metadata?.tenantId
      if (!tenantId) return true
      await applyPlanFromSubscription(tenantId, sub)
      return true
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const tenantId = sub.metadata?.tenantId
      if (!tenantId) return true
      await downgradeToStarter(tenantId)
      return true
    }
    default:
      return false
  }
}

/** Dev-only fallback when Stripe billing is not configured. */
export async function devUpdateTenantPlan(tenantId: string, plan: TenantPlan) {
  if (isBillingConfigured()) {
    throw new ApiError(400, 'Use Stripe Checkout to change plans — direct upgrades are disabled when billing is configured')
  }
  await tenantDb.tenantOrganization.update({ where: { id: tenantId }, data: { plan } })
  const { authDb } = await import('./db')
  await authDb.tenant.update({ where: { id: tenantId }, data: { plan } }).catch(() => undefined)
  return tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
}
