import type Stripe from 'stripe'

/** Stripe Connect direct-charge context for a distributor (connected account). */
export type StripeConnectContext = {
  connectedAccountId: string
  tenantId: string
}

export function stripeAccountOpts(ctx: StripeConnectContext): Stripe.RequestOptions {
  return { stripeAccount: ctx.connectedAccountId }
}

/**
 * Platform application fee in cents for direct charges.
 * ASSUMPTION: configure STRIPE_PLATFORM_APPLICATION_FEE_BPS (basis points, e.g. 250 = 2.5%).
 * If unset, no application_fee_amount is sent — FastFlyrr fee structure TBD.
 */
export function computePlatformApplicationFeeCents(amountCents: number): number | undefined {
  const raw = process.env.STRIPE_PLATFORM_APPLICATION_FEE_BPS?.trim()
  if (!raw) return undefined
  const bps = Number.parseInt(raw, 10)
  if (!Number.isFinite(bps) || bps <= 0) return undefined
  return Math.round((amountCents * bps) / 10_000)
}

export function applicationFeeParams(amountCents: number): { application_fee_amount?: number } {
  const fee = computePlatformApplicationFeeCents(amountCents)
  return fee != null && fee > 0 ? { application_fee_amount: fee } : {}
}
