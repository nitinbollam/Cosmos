import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeCycleCountDelta,
  cycleCountLineNeedsAdjustment,
} from './cycle-count-adjust'

test('computeCycleCountDelta returns counted minus system', () => {
  assert.equal(computeCycleCountDelta(10, 12), 2)
  assert.equal(computeCycleCountDelta(10, 8), -2)
  assert.equal(computeCycleCountDelta(10, 10), 0)
})

test('cycleCountLineNeedsAdjustment ignores null counts and matches', () => {
  assert.equal(cycleCountLineNeedsAdjustment(10, null), false)
  assert.equal(cycleCountLineNeedsAdjustment(10, 10), false)
  assert.equal(cycleCountLineNeedsAdjustment(10, 9), true)
})
