import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Stripe from 'stripe'
import { logger } from '@cosmos/logger'

export interface AuthorizeResult {
  success: boolean
  paymentIntentId?: string
  status?: string
  amount?: number
  error?: string
}

export interface CaptureResult {
  success: boolean
  paymentIntentId?: string
  status?: string
  error?: string
}

export interface RefundResult {
  success: boolean
  refundId?: string
  error?: string
}

@Injectable()
export class StripeAdapter {
  private stripe: Stripe

  constructor(private config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY')
    if (!key) {
      logger.warn('STRIPE_SECRET_KEY not set — stripe adapter will fail at runtime')
    }
    this.stripe = new Stripe(key ?? 'sk_test_missing', {
      apiVersion: '2024-06-20',
      telemetry: false,
    })
  }

  async authorize(
    amount: number,
    currency: string,
    customerId: string,
    paymentMethodId: string,
  ): Promise<AuthorizeResult> {
    try {
      const intent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        customer: customerId,
        payment_method: paymentMethodId,
        capture_method: 'manual',
        confirm: true,
        return_url: this.config.get<string>('STRIPE_RETURN_URL'),
      })
      return { success: true, paymentIntentId: intent.id, status: intent.status, amount }
    } catch (error) {
      const se = error as Stripe.errors.StripeError
      logger.error({ err: se.message, code: se.code }, 'Stripe auth failed')
      return { success: false, error: se.message }
    }
  }

  async capture(paymentIntentId: string, amount?: number): Promise<CaptureResult> {
    try {
      const intent = await this.stripe.paymentIntents.capture(paymentIntentId, {
        ...(amount && { amount_to_capture: Math.round(amount * 100) }),
      })
      return { success: true, paymentIntentId: intent.id, status: intent.status }
    } catch (error) {
      return { success: false, error: (error as Stripe.errors.StripeError).message }
    }
  }

  async void(paymentIntentId: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(paymentIntentId)
  }

  async refund(paymentIntentId: string, amount?: number): Promise<RefundResult> {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        ...(amount && { amount: Math.round(amount * 100) }),
      })
      return { success: true, refundId: refund.id }
    } catch (error) {
      return { success: false, error: (error as Stripe.errors.StripeError).message }
    }
  }

  async processACH(amount: number, bankAccountToken: string, customerId: string): Promise<AuthorizeResult> {
    try {
      const intent = await this.stripe.paymentIntents.create({
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

  verifyWebhook(rawBody: Buffer, signatureHeader: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured')
    return this.stripe.webhooks.constructEvent(rawBody, signatureHeader, secret)
  }
}
