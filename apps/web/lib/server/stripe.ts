import Stripe from 'stripe'
import {
  applicationFeeParams,
  type StripeConnectContext,
  stripeAccountOpts,
} from './stripe-context'

export type AuthorizeResult = {
  success: boolean
  paymentIntentId?: string
  status?: string
  amount?: number
  error?: string
  requiresAction?: boolean
  clientSecret?: string
}

export type CaptureResult = {
  success: boolean
  paymentIntentId?: string
  status?: string
  error?: string
}

export type RefundResult = {
  success: boolean
  refundId?: string
  error?: string
}

export function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return new Stripe(key, { apiVersion: '2024-06-20', telemetry: false })
}

function stripeClient(): Stripe {
  return getStripeClient()
}

export function isWebhookSecretConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim())
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

export function assertRealStripePaymentMethodId(paymentMethodId: string): void {
  const id = paymentMethodId.trim()
  if (!id.startsWith('pm_')) {
    throw new Error('Invalid Stripe payment method id')
  }
  if (id.startsWith('pm_demo_')) {
    throw new Error('Demo payment methods cannot be used with Stripe')
  }
}

export type EnsureStripeCustomerInput = {
  cosmosCustomerId: string
  tenantId: string
  name: string
  email?: string | null
  existingStripeCustomerId?: string | null
  existingConnectAccountId?: string | null
}

/** Resolve or create a Stripe Customer on the connected account (direct charges). */
export async function ensureStripeCustomer(
  ctx: StripeConnectContext,
  input: EnsureStripeCustomerInput,
): Promise<string> {
  const stripe = stripeClient()
  const opts = stripeAccountOpts(ctx)
  const existing = input.existingStripeCustomerId?.trim()
  const sameAccount = input.existingConnectAccountId === ctx.connectedAccountId

  if (existing?.startsWith('cus_') && sameAccount) {
    try {
      await stripe.customers.retrieve(existing, opts)
      return existing
    } catch {
      /* stale or wrong account namespace — create below */
    }
  }

  const customer = await stripe.customers.create(
    {
      name: input.name,
      email: input.email?.trim() || undefined,
      metadata: {
        cosmosCustomerId: input.cosmosCustomerId,
        tenantId: input.tenantId,
      },
    },
    opts,
  )
  return customer.id
}

export async function attachPaymentMethod(
  ctx: StripeConnectContext,
  stripeCustomerId: string,
  paymentMethodId: string,
): Promise<void> {
  assertRealStripePaymentMethodId(paymentMethodId)
  const stripe = stripeClient()
  const opts = stripeAccountOpts(ctx)
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: stripeCustomerId }, opts)
  } catch (error) {
    const se = error as Stripe.errors.StripeError
    if (se.code === 'resource_already_exists' || se.message?.includes('already been attached')) return
    throw error
  }
}

export async function authorizePayment(
  ctx: StripeConnectContext,
  amount: number,
  currency: string,
  stripeCustomerId: string,
  paymentMethodId: string,
): Promise<AuthorizeResult> {
  try {
    assertRealStripePaymentMethodId(paymentMethodId)
    const stripe = stripeClient()
    const opts = stripeAccountOpts(ctx)
    const amountCents = Math.round(amount * 100)
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: currency.toLowerCase(),
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        capture_method: 'manual',
        confirm: true,
        return_url: process.env.STRIPE_RETURN_URL,
        ...applicationFeeParams(amountCents),
      },
      opts,
    )
    if (intent.status === 'requires_action' && intent.client_secret) {
      return {
        success: false,
        requiresAction: true,
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        status: intent.status,
        error: 'Card requires additional authentication',
      }
    }
    if (intent.status === 'requires_capture' || intent.status === 'succeeded') {
      return { success: true, paymentIntentId: intent.id, status: intent.status, amount }
    }
    return { success: false, error: `Unexpected payment status: ${intent.status}` }
  } catch (error) {
    const se = error as Stripe.errors.StripeError
    return { success: false, error: se.message }
  }
}

export async function chargePaymentMethod(
  ctx: StripeConnectContext,
  amount: number,
  currency: string,
  stripeCustomerId: string,
  paymentMethodId: string,
): Promise<AuthorizeResult> {
  try {
    assertRealStripePaymentMethodId(paymentMethodId)
    const stripe = stripeClient()
    const opts = stripeAccountOpts(ctx)
    const amountCents = Math.round(amount * 100)
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: currency.toLowerCase(),
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        capture_method: 'automatic',
        confirm: true,
        return_url: process.env.STRIPE_RETURN_URL,
        ...applicationFeeParams(amountCents),
      },
      opts,
    )
    if (intent.status === 'requires_action' && intent.client_secret) {
      return {
        success: false,
        requiresAction: true,
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
        status: intent.status,
        error: 'Card requires additional authentication',
      }
    }
    if (intent.status === 'succeeded') {
      return { success: true, paymentIntentId: intent.id, status: intent.status, amount }
    }
    return { success: false, error: `Unexpected payment status: ${intent.status}` }
  } catch (error) {
    const se = error as Stripe.errors.StripeError
    return { success: false, error: se.message }
  }
}

export async function detachPaymentMethod(ctx: StripeConnectContext, paymentMethodId: string): Promise<void> {
  assertRealStripePaymentMethodId(paymentMethodId)
  const stripe = stripeClient()
  await stripe.paymentMethods.detach(paymentMethodId, stripeAccountOpts(ctx))
}

export async function processAchPayment(
  ctx: StripeConnectContext,
  amount: number,
  bankAccountToken: string,
  stripeCustomerId: string,
): Promise<AuthorizeResult> {
  try {
    const stripe = stripeClient()
    const opts = stripeAccountOpts(ctx)
    const amountCents = Math.round(amount * 100)
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: bankAccountToken,
        payment_method_types: ['us_bank_account'],
        confirm: true,
        ...applicationFeeParams(amountCents),
      },
      opts,
    )
    return { success: true, paymentIntentId: intent.id, status: intent.status, amount }
  } catch (error) {
    return { success: false, error: (error as Stripe.errors.StripeError).message }
  }
}

export async function capturePayment(
  ctx: StripeConnectContext,
  paymentIntentId: string,
  amount?: number,
): Promise<CaptureResult> {
  try {
    const stripe = stripeClient()
    const intent = await stripe.paymentIntents.capture(
      paymentIntentId,
      {
        ...(amount != null ? { amount_to_capture: Math.round(amount * 100) } : {}),
      },
      stripeAccountOpts(ctx),
    )
    return { success: true, paymentIntentId: intent.id, status: intent.status }
  } catch (error) {
    return { success: false, error: (error as Stripe.errors.StripeError).message }
  }
}

export async function voidPayment(ctx: StripeConnectContext, paymentIntentId: string): Promise<void> {
  const stripe = stripeClient()
  await stripe.paymentIntents.cancel(paymentIntentId, stripeAccountOpts(ctx))
}

export async function refundPayment(
  ctx: StripeConnectContext,
  paymentIntentId: string,
  amount?: number,
): Promise<RefundResult> {
  try {
    const stripe = stripeClient()
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        ...(amount != null ? { amount: Math.round(amount * 100) } : {}),
      },
      stripeAccountOpts(ctx),
    )
    return { success: true, refundId: refund.id }
  } catch (error) {
    return { success: false, error: (error as Stripe.errors.StripeError).message }
  }
}

/** Platform-level webhook (FastFlyrr SaaS billing only — not Connect payment events). */
export function verifyStripeWebhook(rawBody: Buffer, signatureHeader: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured')
  return stripeClient().webhooks.constructEvent(rawBody, signatureHeader, secret)
}

export async function retrievePaymentIntent(
  ctx: StripeConnectContext,
  stripeIntentId: string,
): Promise<Stripe.PaymentIntent> {
  return stripeClient().paymentIntents.retrieve(stripeIntentId, stripeAccountOpts(ctx))
}
