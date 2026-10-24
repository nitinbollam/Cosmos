import type Stripe from 'stripe'

/** Stripe Connect direct-charge context for a distributor (connected account). */
export type StripeConnectContext = {
  connectedAccountId: string
  tenantId: string
}

/**
 * Request options for a Stripe call, or undefined when there are none. stripe-node only recognises an
 * options object by its keys, so an empty {} is read as an extra argument and the call throws
 * "Unknown arguments" (direct charges with no Connect account).
 */
export function stripeAccountOpts(
  ctx: StripeConnectContext,
  extra?: Stripe.RequestOptions,
): Stripe.RequestOptions | undefined {
  const opts: Stripe.RequestOptions = {
    ...(ctx.connectedAccountId ? { stripeAccount: ctx.connectedAccountId } : {}),
    ...extra,
  }
  return Object.keys(opts).length ? opts : undefined
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
