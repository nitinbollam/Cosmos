import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computePlatformApplicationFeeCents,
  applicationFeeParams,
  stripeAccountOpts,
} from './stripe-context'
import {
  assertRealStripePaymentMethodId,
  isStripeConfigured,
  isWebhookSecretConfigured,
} from './stripe'
import {
  deriveConnectOnboardingStatus,
  type TenantStripeConnectState,
} from './tenant-stripe-connect'
import { buildPaymentSummary } from './order-payment-admin'
import { stripeIntegrationStatus } from './payments'
import { paymentDb, orderDb, tenantDb, crmDb } from './db'

test.after(async () => {
  await Promise.allSettled([
    paymentDb.$disconnect(),
    orderDb.$disconnect(),
    tenantDb.$disconnect(),
    crmDb.$disconnect(),
  ])
})

test('computePlatformApplicationFeeCents calculates basis points correctly', () => {
  const original = process.env.STRIPE_PLATFORM_APPLICATION_FEE_BPS
  try {
    process.env.STRIPE_PLATFORM_APPLICATION_FEE_BPS = '250' // 2.5%
    // $100.00 = 10000 cents -> 250 cents ($2.50)
    assert.equal(computePlatformApplicationFeeCents(10000), 250)
    // $53.20 = 5320 cents -> 133 cents ($1.33)
    assert.equal(computePlatformApplicationFeeCents(5320), 133)

    assert.deepEqual(applicationFeeParams(10000), { application_fee_amount: 250 })

    process.env.STRIPE_PLATFORM_APPLICATION_FEE_BPS = ''
    assert.equal(computePlatformApplicationFeeCents(10000), undefined)
    assert.deepEqual(applicationFeeParams(10000), {})
  } finally {
    process.env.STRIPE_PLATFORM_APPLICATION_FEE_BPS = original
  }
})

test('stripeAccountOpts formats connected account request headers', () => {
  const opts = stripeAccountOpts({ connectedAccountId: 'acct_12345', tenantId: 't1' })
  assert.deepEqual(opts, { stripeAccount: 'acct_12345' })
})

test('assertRealStripePaymentMethodId validates real vs demo payment methods', () => {
  assert.doesNotThrow(() => assertRealStripePaymentMethodId('pm_1OabCdEfGhIjKlMnOpQrStUv'))
  assert.throws(() => assertRealStripePaymentMethodId('pm_demo_4242'), /Demo payment methods cannot be used/)
  assert.throws(() => assertRealStripePaymentMethodId('card_1234'), /Invalid Stripe payment method id/)
  assert.throws(() => assertRealStripePaymentMethodId(''), /Invalid Stripe payment method id/)
})

test('deriveConnectOnboardingStatus handles all onboarding phases', () => {
  const notStarted: TenantStripeConnectState = {
    stripeConnectedAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: false,
  }
  assert.equal(deriveConnectOnboardingStatus(notStarted), 'not_started')

  const pending: TenantStripeConnectState = {
    stripeConnectedAccountId: 'acct_123',
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: false,
  }
  assert.equal(deriveConnectOnboardingStatus(pending), 'pending')

  const restricted: TenantStripeConnectState = {
    stripeConnectedAccountId: 'acct_123',
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    stripeDetailsSubmitted: true,
  }
  assert.equal(deriveConnectOnboardingStatus(restricted), 'restricted')

  const ready: TenantStripeConnectState = {
    stripeConnectedAccountId: 'acct_123',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
  }
  assert.equal(deriveConnectOnboardingStatus(ready), 'ready')
})

test('buildPaymentSummary calculates balances, refundable amounts and Stripe URLs', () => {
  const order = { totalAmount: 150.0, amountPaid: 150.0 }
  const intent = {
    id: 'pi_cosmos_1',
    stripeIntentId: 'pi_stripe_1',
    status: 'CAPTURED',
    amount: 150.0,
    capturedAmount: 150.0,
    refundedAmount: 50.0,
    failureReason: null,
  }
  const connect = { stripeConnectedAccountId: 'acct_test_1' }

  const summary = buildPaymentSummary(order, intent, connect)
  assert.equal(summary.paymentIntentId, 'pi_cosmos_1')
  assert.equal(summary.stripeIntentId, 'pi_stripe_1')
  assert.equal(summary.stripeConnectedAccountId, 'acct_test_1')
  assert.equal(
    summary.stripeDashboardPaymentUrl,
    'https://dashboard.stripe.com/connect/accounts/acct_test_1/payments/pi_stripe_1',
  )
  assert.equal(summary.paymentStatus, 'CAPTURED')
  assert.equal(summary.amountPaidOnOrder, 150.0)
  assert.equal(summary.orderBalance, 0)
  assert.equal(summary.refundableAmount, 100.0) // 150 captured - 50 refunded
})

test('stripeIntegrationStatus reports environment config status', () => {
  const status = stripeIntegrationStatus()
  assert.equal(typeof status.secretKeyConfigured, 'boolean')
  assert.equal(typeof status.webhookSigningSecretConfigured, 'boolean')
  assert.equal(typeof status.connectWebhookSigningSecretConfigured, 'boolean')
  assert.ok(status.rotation.includes('STRIPE_WEBHOOK_SECRET'))
})
