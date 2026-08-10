import Stripe from 'stripe'
import { tenantDb } from './db'
import { ApiError } from './session'
import {
  deriveConnectOnboardingStatus,
  findTenantIdByConnectedAccount,
  getTenantStripeConnectState,
  updateTenantFromStripeAccount,
} from './tenant-stripe-connect'
import * as stripe from './stripe'
import { syncConnectPaymentIntentEvent } from './payments'

function stripeClient(): Stripe {
  return stripe.getStripeClient()
}

function connectReturnBase(): string {
  return (
    process.env.STRIPE_CONNECT_RETURN_URL?.trim() ||
    process.env.PLEROS_CLIENT_ORIGIN?.trim() ||
    process.env.COSMOS_CLIENT_ORIGIN?.trim() ||
    process.env.NEXT_PUBLIC_WEB_ADMIN_ORIGIN?.trim() ||
    'http://localhost:4000'
  ).replace(/\/$/, '')
}

export function isConnectWebhookSecretConfigured(): boolean {
  return Boolean(process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim())
}

export function verifyConnectWebhook(rawBody: Buffer, signatureHeader: string): Stripe.Event {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim()
  if (!secret) throw new Error('STRIPE_CONNECT_WEBHOOK_SECRET not configured')
  return stripeClient().webhooks.constructEvent(rawBody, signatureHeader, secret)
}

export async function getConnectStatus(tenantId: string) {
  const org = await getTenantStripeConnectState(tenantId)
  const onboardingStatus = deriveConnectOnboardingStatus(org)
  return {
    ...org,
    onboardingStatus,
    platformFeeConfigured: Boolean(process.env.STRIPE_PLATFORM_APPLICATION_FEE_BPS?.trim()),
    // ASSUMPTION: fee % lives in STRIPE_PLATFORM_APPLICATION_FEE_BPS; not exposed to client as a number until product confirms.
    connectWebhookConfigured: isConnectWebhookSecretConfigured(),
  }
}

export async function createExpressConnectedAccount(tenantId: string, email?: string | null) {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new ApiError(404, 'Tenant organization not found')
  if (org.stripeConnectedAccountId) {
    return { accountId: org.stripeConnectedAccountId, created: false as const }
  }

  const account = await stripeClient().accounts.create({
    type: 'express',
    email: email?.trim() || org.billingEmail?.trim() || undefined,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      cosmosTenantId: tenantId,
      cosmosSlug: org.slug,
    },
  })

  await tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: { stripeConnectedAccountId: account.id },
  })

  return { accountId: account.id, created: true as const }
}

export async function createConnectAccountLink(tenantId: string, type: 'account_onboarding' | 'account_update') {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org?.stripeConnectedAccountId) {
    throw new ApiError(400, 'Create a connected account before generating an onboarding link')
  }

  const base = connectReturnBase()
  const link = await stripeClient().accountLinks.create({
    account: org.stripeConnectedAccountId,
    type,
    return_url: `${base}/admin/settings?tab=integrations&stripe=return`,
    refresh_url: `${base}/admin/settings?tab=integrations&stripe=refresh`,
  })

  return { url: link.url, expiresAt: link.expires_at }
}

export async function startConnectOnboarding(tenantId: string, email?: string | null) {
  await createExpressConnectedAccount(tenantId, email)
  return createConnectAccountLink(tenantId, 'account_onboarding')
}

export function handleStripeConnectWebhook(rawBody: Buffer, signature: string) {
  try {
    const event = verifyConnectWebhook(rawBody, signature)
    void dispatchConnectWebhookEvent(event).catch((err) => {
      console.error('[stripe connect webhook]', event.type, err)
    })
    return { received: true, type: event.type, account: event.account ?? null }
  } catch {
    return { received: false }
  }
}

async function dispatchConnectWebhookEvent(event: Stripe.Event) {
  const accountId = event.account
  if (!accountId) return

  if (event.type === 'account.updated') {
    const acct = event.data.object as Stripe.Account
    await updateTenantFromStripeAccount(accountId, {
      chargesEnabled: acct.charges_enabled ?? false,
      payoutsEnabled: acct.payouts_enabled ?? false,
      detailsSubmitted: acct.details_submitted ?? false,
    })
    return
  }

  if (
    event.type === 'payment_intent.succeeded' ||
    event.type === 'payment_intent.payment_failed' ||
    event.type === 'payment_intent.canceled'
  ) {
    await syncConnectPaymentIntentEvent(event)
    return
  }

  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute
    const tenantId = await findTenantIdByConnectedAccount(accountId)
    if (!tenantId) return
    const { auditLog } = await import('./audit-log')
    await auditLog(tenantId, {
      action: 'stripe.dispute.created',
      entityType: 'StripeDispute',
      entityId: dispute.id,
      metadata: {
        chargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id,
        amount: dispute.amount,
        reason: dispute.reason,
        status: dispute.status,
        connectedAccountId: accountId,
      },
    }).catch(() => undefined)

    const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
    const recipient = org?.billingEmail?.trim()
    if (recipient) {
      const notifications = await import('./notifications')
      await notifications
        .send(tenantId, {
          channel: 'EMAIL' as never,
          recipient,
          templateKey: 'stripe.dispute.created',
          payload: {
            disputeId: dispute.id,
            amount: dispute.amount / 100,
            reason: dispute.reason,
            note: "Disputes on connected accounts are the distributor's liability — review in Stripe Dashboard.",
          },
        })
        .catch(() => undefined)
    }
  }
}

export function stripeConnectDashboardPaymentUrl(connectedAccountId: string, paymentIntentId: string): string {
  return `https://dashboard.stripe.com/connect/accounts/${encodeURIComponent(connectedAccountId)}/payments/${encodeURIComponent(paymentIntentId)}`
}

export function stripeConnectDashboardAccountUrl(connectedAccountId: string): string {
  return `https://dashboard.stripe.com/connect/accounts/${encodeURIComponent(connectedAccountId)}`
}
