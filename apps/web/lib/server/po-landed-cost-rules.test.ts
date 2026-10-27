import assert from 'node:assert/strict'
import test from 'node:test'
import { landedCostChangeBlocker, type LandedCostChange } from './po-landed-cost-rules'

const base: LandedCostChange = { status: 'DRAFT', currentTotal: 1000, newTotal: 9000, threshold: 2500, approvedTotal: null }

test('a draft can be changed freely', () => {
  assert.equal(landedCostChangeBlocker(base), null)
  assert.equal(landedCostChangeBlocker({ ...base, status: 'CANCELLED' }), null)
})

test('while waiting for approval the charges are locked, even for a decrease', () => {
  const msg = landedCostChangeBlocker({ ...base, status: 'PENDING_APPROVAL', newTotal: 500 })
  assert.match(msg!, /waiting for approval/)
  assert.match(msg!, /reject it/)
})

test('after submission a total at or under the approval threshold may change', () => {
  assert.equal(landedCostChangeBlocker({ ...base, status: 'SUBMITTED', currentTotal: 1000, newTotal: 2500 }), null)
})

test('after submission the total cannot be raised past the threshold when no approval was needed', () => {
  const msg = landedCostChangeBlocker({ ...base, status: 'SUBMITTED', currentTotal: 2000, newTotal: 2600 })
  assert.equal(
    msg,
    'This change takes the purchase order total to $2600.00, above the $2500.00 approval threshold. Lower the charges, or cancel this order and create a new one for approval.',
  )
})

test('after approval the total cannot be raised past the amount it was approved for', () => {
  const approved = { ...base, status: 'SUBMITTED', currentTotal: 5400, approvedTotal: 5400 }
  assert.equal(landedCostChangeBlocker({ ...approved, newTotal: 5400 }), null)
  assert.equal(landedCostChangeBlocker({ ...approved, newTotal: 5000 }), null)
  assert.match(landedCostChangeBlocker({ ...approved, newTotal: 5400.01 + 0.01 })!, /above the \$5400\.00 it was approved for/)
  assert.match(landedCostChangeBlocker({ ...approved, newTotal: 9000, status: 'PARTIALLY_RECEIVED' })!, /\$9000\.00, above/)
})

test('a lowered or unchanged total is always allowed once submitted', () => {
  assert.equal(landedCostChangeBlocker({ ...base, status: 'SUBMITTED', currentTotal: 7000, newTotal: 6000, approvedTotal: 5400 }), null)
  assert.equal(landedCostChangeBlocker({ ...base, status: 'SUBMITTED', currentTotal: 7000, newTotal: 7000, approvedTotal: 5400 }), null)
})

test('the larger of the threshold and the approved total is the limit', () => {
  const c = { ...base, status: 'SUBMITTED', currentTotal: 2000, threshold: 6000, approvedTotal: 5400 }
  assert.equal(landedCostChangeBlocker({ ...c, newTotal: 6000 }), null)
  assert.match(landedCostChangeBlocker({ ...c, newTotal: 6100 })!, /above the \$6000\.00 approval threshold/)
})

test('a closed order is not covered here (the existing closed/cancelled rule handles it)', () => {
  assert.equal(landedCostChangeBlocker({ ...base, status: 'CLOSED' }), null)
})
