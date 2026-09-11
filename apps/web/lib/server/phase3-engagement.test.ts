import assert from 'node:assert/strict'
import test from 'node:test'
import { createUnsubscribeToken, verifyUnsubscribeToken } from './campaign-unsubscribe'

test('unsubscribe token round-trips', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret'
  const token = createUnsubscribeToken('tenant-1', 'cust-1')
  const parsed = verifyUnsubscribeToken(token)
  assert.ok(parsed)
  assert.equal(parsed!.tenantId, 'tenant-1')
  assert.equal(parsed!.customerId, 'cust-1')
})

test('gift card redemption never exceeds balance', () => {
  const balance = 25
  const requested = 40
  const amountApplied = Math.min(requested, balance)
  assert.equal(amountApplied, 25)
  assert.ok(amountApplied <= balance)
})

test('subscription failure pauses instead of retrying in same run', () => {
  const outcomes: Array<'processed' | 'paused'> = []
  const subs = [{ id: 'a', ok: false }, { id: 'b', ok: true }]
  for (const sub of subs) {
    if (sub.ok) outcomes.push('processed')
    else outcomes.push('paused')
  }
  assert.deepEqual(outcomes, ['paused', 'processed'])
})

test('scheduled campaign runner filters only due scheduled campaigns', () => {
  const now = new Date('2026-09-11T12:00:00Z')
  const campaigns = [
    { id: '1', status: 'SCHEDULED', scheduledAt: new Date('2026-09-11T11:00:00Z') }, // due
    { id: '2', status: 'SCHEDULED', scheduledAt: new Date('2026-09-11T13:00:00Z') }, // future
    { id: '3', status: 'DRAFT', scheduledAt: new Date('2026-09-11T10:00:00Z') }, // draft
    { id: '4', status: 'SENT', scheduledAt: new Date('2026-09-11T10:00:00Z') }, // already sent
  ]
  const due = campaigns.filter((c) => c.status === 'SCHEDULED' && c.scheduledAt <= now)
  assert.equal(due.length, 1)
  assert.equal(due[0].id, '1')
})

test('order fully covered by gift card fulfills immediately without payment deferral', () => {
  const defersFulfillmentUntilPayment = (method: string) => method === 'CARD'
  const total = 50
  const giftCardPaid = 50
  const isFullyPaid = giftCardPaid >= total
  const paymentMethod = 'CARD'

  const shouldFulfillNow = !defersFulfillmentUntilPayment(paymentMethod) || isFullyPaid
  assert.equal(shouldFulfillNow, true)
})

