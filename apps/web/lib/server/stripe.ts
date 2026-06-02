import Stripe from 'stripe'

export type AuthorizeResult = {
  success: boolean
  paymentIntentId?: string
  status?: string
  amount?: number
  error?: string
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

function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  return new Stripe(key, { apiVersion: '2024-06-20', telemetry: false })
}

export function isWebhookSecretConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim())
}

export async function authorizePayment(
  amount: number,
  currency: string,
  customerId: string,
  paymentMethodId: string,
): Promise<AuthorizeResult> {
  try {
    const stripe = stripeClient()
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      customer: customerId,
      payment_method: paymentMethodId,
      capture_method: 'manual',
      confirm: true,
      return_url: process.env.STRIPE_RETURN_URL,
    })
    return { success: true, paymentIntentId: intent.id, status: intent.status, amount }
  } catch (error) {
    const se = error as Stripe.errors.StripeError
    return { success: false, error: se.message }
  }
}

export async function processAchPayment(
  amount: number,
  bankAccountToken: string,
  customerId: string,
): Promise<AuthorizeResult> {
  try {
    const stripe = stripeClient()
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      customer: customerId,
      payment_method: bankAccountToken,
      payment_method_types: ['us_bank_account'],
      confirm: true,
    })
    return { success: true, paymentIntentId: intent.id, status: intent.status, amount }
  } catch (error) {
    return { success: false, error: (error as Stripe.errors.StripeError).message }
  }
}

export async function capturePayment(paymentIntentId: string, amount?: number): Promise<CaptureResult> {
  try {
    const stripe = stripeClient()
    const intent = await stripe.paymentIntents.capture(paymentIntentId, {
      ...(amount != null ? { amount_to_capture: Math.round(amount * 100) } : {}),
    })
    return { success: true, paymentIntentId: intent.id, status: intent.status }
  } catch (error) {
    return { success: false, error: (error as Stripe.errors.StripeError).message }
  }
}

export async function voidPayment(paymentIntentId: string): Promise<void> {
  const stripe = stripeClient()
  await stripe.paymentIntents.cancel(paymentIntentId)
}

export async function refundPayment(paymentIntentId: string, amount?: number): Promise<RefundResult> {
  try {
    const stripe = stripeClient()
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      ...(amount != null ? { amount: Math.round(amount * 100) } : {}),
    })
    return { success: true, refundId: refund.id }
  } catch (error) {
    return { success: false, error: (error as Stripe.errors.StripeError).message }
  }
}

export function verifyStripeWebhook(rawBody: Buffer, signatureHeader: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured')
  return stripeClient().webhooks.constructEvent(rawBody, signatureHeader, secret)
}
