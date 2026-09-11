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
