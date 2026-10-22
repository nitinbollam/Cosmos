import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adjustmentPosting } from './stock-gl'

test('units lost are valued at cost, units found reverse it', () => {
  assert.deepEqual(adjustmentPosting('2.50', -4), { kind: 'STOCK_WRITE_OFF_JOURNAL', amount: '10' })
  assert.deepEqual(adjustmentPosting('2.50', 3), { kind: 'STOCK_FOUND_JOURNAL', amount: '7.5' })
})

test('no cost, no change or a fractional count posts nothing, and cents round once', () => {
  assert.equal(adjustmentPosting(null, -4), null)
  assert.equal(adjustmentPosting('0', -4), null)
  assert.equal(adjustmentPosting('5', 0), null)
  assert.equal(adjustmentPosting('5', -1.5), null)
  assert.deepEqual(adjustmentPosting('0.335', -3), { kind: 'STOCK_WRITE_OFF_JOURNAL', amount: '1.01' })
})
