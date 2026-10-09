import * as stripe from './stripe'
import { getTenantStripeConnectState } from './tenant-stripe-connect'
import {
  MARKETPLACE_COMMISSION_RATE,
  commissionRateForListingType,
  computeMarketplaceCommission,
  computeMarketplaceTransferCents,
} from './marketplace-constants'
import { ensureMarketplacePlatformCustomer } from './marketplace-buyer-payments'
import { ApiError } from './session'

export { computeMarketplaceTransferCents }

export function marketplaceApplicationFeeCents(grossCents: number): number {
  return computeMarketplaceCommission(grossCents)
}

/** Create a platform-held PaymentIntent (manual capture) for a marketplace order. */
export async function createMarketplacePaymentIntent(input: {
  orderId: string
  buyerTenantId: string
  sellerTenantId: string
  amountCents: number
}) {
  if (!stripe.isStripeConfigured()) {
    throw new ApiError(503, 'Stripe is not configured')
  }
  if (input.amountCents < 50) throw new ApiError(400, 'Order total too small for card payment')

  const seller = await getTenantStripeConnectState(input.sellerTenantId)
  if (!seller.stripeConnectedAccountId || !seller.stripeChargesEnabled) {
    throw new ApiError(402, 'Seller has not completed Stripe Connect onboarding')
  }

  const client = stripe.getStripeClient()
  const intent = await client.paymentIntents.create({
    amount: input.amountCents,
    currency: 'usd',
    capture_method: 'manual',
    metadata: {
      cosmosMarketplaceOrderId: input.orderId,
      cosmosBuyerTenantId: input.buyerTenantId,
      cosmosSellerTenantId: input.sellerTenantId,
      cosmosMarketplaceCommissionRate: String(MARKETPLACE_COMMISSION_RATE),
    },
  })

  if (!intent.client_secret) throw new ApiError(500, 'Stripe did not return a client secret')

  return {
    stripePaymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amountCents: input.amountCents,
  }
}

/** Verify PI belongs to order, capture if needed, mark escrow held. */
export async function captureMarketplacePaymentIntent(
  orderId: string,
  buyerTenantId: string,
  sellerTenantId: string,
  amountCents: number,
  stripePaymentIntentId: string,
) {
  if (!stripe.isStripeConfigured()) {
    throw new ApiError(503, 'Stripe is not configured')
  }

  const client = stripe.getStripeClient()
  const intent = await client.paymentIntents.retrieve(stripePaymentIntentId)

  if (intent.metadata?.cosmosMarketplaceOrderId !== orderId) {
    throw new ApiError(400, 'PaymentIntent does not match this order')
  }
  if (intent.metadata?.cosmosBuyerTenantId !== buyerTenantId) {
    throw new ApiError(400, 'PaymentIntent buyer mismatch')
  }
  if (intent.amount !== amountCents) {
    throw new ApiError(400, 'PaymentIntent amount mismatch')
  }

  if (intent.status === 'requires_capture') {
    const captured = await client.paymentIntents.capture(stripePaymentIntentId)
    if (captured.status !== 'succeeded') {
      throw new ApiError(402, `Capture failed: ${captured.status}`)
    }
  } else if (intent.status !== 'succeeded') {
    throw new ApiError(402, `Payment not ready: ${intent.status}`)
  }

  await getTenantStripeConnectState(sellerTenantId)

  return { stripePaymentIntentId, captured: true as const }
}

/** Transfer escrowed funds to seller Connect account after hold window. */
export async function transferMarketplaceEscrowToSeller(input: {
  orderId: string
  sellerTenantId: string
  grossCents: number
  stripePaymentIntentId: string
}) {
  if (!stripe.isStripeConfigured()) {
    throw new ApiError(503, 'Stripe is not configured')
  }

  const seller = await getTenantStripeConnectState(input.sellerTenantId)
  if (!seller.stripeConnectedAccountId) {
    throw new ApiError(402, 'Seller Connect account missing')
  }

  const transferCents = computeMarketplaceTransferCents(input.grossCents)
  if (transferCents < 1) throw new ApiError(400, 'Nothing to transfer after commission')

  const client = stripe.getStripeClient()
  const transfer = await client.transfers.create({
    amount: transferCents,
    currency: 'usd',
    destination: seller.stripeConnectedAccountId,
    metadata: {
      cosmosMarketplaceOrderId: input.orderId,
      cosmosPaymentIntentId: input.stripePaymentIntentId,
      cosmosPlatformFeeCents: String(marketplaceApplicationFeeCents(input.grossCents)),
    },
  })

  return { transferId: transfer.id, transferCents, feeCents: marketplaceApplicationFeeCents(input.grossCents) }
}

export type OffSessionChargeResult =
  | { success: true; stripePaymentIntentId: string; requiresAction: false }
  | { success: false; requiresAction: true; stripePaymentIntentId: string; clientSecret: string; error: string }
  | { success: false; requiresAction: false; error: string }

/** Auto-charge auction winner (or retry) on platform account with saved card. */
export async function chargeMarketplaceBuyerOffSession(input: {
  orderId: string
  buyerTenantId: string
  sellerTenantId: string
  amountCents: number
  paymentMethodId: string
  listingType?: 'FIXED' | 'AUCTION'
}): Promise<OffSessionChargeResult> {
  if (!stripe.isStripeConfigured()) {
    return { success: false, requiresAction: false, error: 'Stripe is not configured' }
  }
  if (input.amountCents < 50) {
    return { success: false, requiresAction: false, error: 'Amount too small' }
  }

  const seller = await getTenantStripeConnectState(input.sellerTenantId)
  if (!seller.stripeConnectedAccountId || !seller.stripeChargesEnabled) {
    return { success: false, requiresAction: false, error: 'Seller Connect onboarding incomplete' }
  }

  const stripeCustomerId = await ensureMarketplacePlatformCustomer(input.buyerTenantId)
  const client = stripe.getStripeClient()
  const rate = commissionRateForListingType(input.listingType ?? 'AUCTION')

  try {
    const intent = await client.paymentIntents.create({
      amount: input.amountCents,
      currency: 'usd',
      customer: stripeCustomerId,
      payment_method: input.paymentMethodId,
      capture_method: 'manual',
      confirm: true,
      off_session: true,
      metadata: {
        cosmosMarketplaceOrderId: input.orderId,
        cosmosBuyerTenantId: input.buyerTenantId,
        cosmosSellerTenantId: input.sellerTenantId,
        cosmosMarketplaceCommissionRate: String(rate),
        cosmosOffSession: 'true',
      },
    })

    if (intent.status === 'requires_action' && intent.client_secret) {
      return {
        success: false,
        requiresAction: true,
        stripePaymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        error: 'Card requires authentication',
      }
    }
    if (intent.status === 'requires_capture' || intent.status === 'succeeded') {
      return { success: true, stripePaymentIntentId: intent.id, requiresAction: false }
    }
    return { success: false, requiresAction: false, error: `Unexpected status: ${intent.status}` }
  } catch (error) {
    const se = error as { code?: string; message?: string }
    return { success: false, requiresAction: false, error: se.message ?? 'Charge failed' }
  }
}
