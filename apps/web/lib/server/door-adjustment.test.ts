import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  adjustmentProblem,
  adjustmentsFromPod,
  needsManager,
  normalizeAdjustment,
  podWithAdjustment,
  reductionValueCents,
} from './door-adjustment'
import { podForDelivery } from './stop-outcome'

const ok = { reason: ' Customer only wanted half ', lines: [{ lineItemId: 'l1', quantity: 2 }] }

test('a change needs a reason and at least one whole-number line', () => {
  assert.equal(adjustmentProblem(ok), null)
  assert.match(adjustmentProblem({ ...ok, reason: '  ' })!, /reason/i)
  assert.match(adjustmentProblem({ ...ok, lines: [] })!, /at least one/i)
  assert.match(adjustmentProblem({ ...ok, lines: [{ lineItemId: 'l1', quantity: 0 }] })!, /whole numbers/i)
  assert.match(adjustmentProblem({ ...ok, lines: [{ lineItemId: 'l1', quantity: 1.5 }] })!, /whole numbers/i)
  assert.match(adjustmentProblem({ ...ok, lines: [ok.lines[0], ok.lines[0]] })!, /once/i)
  assert.equal(normalizeAdjustment(ok).reason, 'Customer only wanted half')
})

test('value is computed in cents from the order prices', () => {
  const items = [{ id: 'l1', unitPrice: '10.10' }, { id: 'l2', unitPrice: 3 }]
  assert.equal(reductionValueCents([{ lineItemId: 'l1', quantity: 3 }, { lineItemId: 'l2', quantity: 1 }], items), 3330)
})

test('only drivers are held to the threshold, and 0 means no limit', () => {
  assert.equal(needsManager('DRIVER', 50_001, 500), true)
  assert.equal(needsManager('DRIVER', 50_000, 500), false)
  assert.equal(needsManager('DRIVER', 999_999, 0), false)
  assert.equal(needsManager('MANAGER', 999_999, 500), false)
})

test('adjustments survive delivery and a client cannot write or erase them', () => {
  const rec = { at: 't', by: 'u', reason: 'r', memoId: 'm', memoNumber: 'CM-1', total: '5.00', lines: [] }
  const pod = podWithAdjustment({ failure: { reason: 'x', failedAt: 'y' } }, rec)
  const delivered = podForDelivery(pod, { signature: 's', adjustments: [{ forged: true }] }) as Record<string, unknown>
  assert.deepEqual(adjustmentsFromPod(delivered), [rec])
  assert.ok(delivered.failure)
  assert.equal(delivered.signature, 's')
  assert.deepEqual(adjustmentsFromPod(podForDelivery({}, { adjustments: [rec] })), [])
})
