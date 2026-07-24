import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bucketArAging, type ArAgingBuckets } from './invoices'

function empty(): ArAgingBuckets {
  return { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 }
}

test('bucketArAging ignores near-zero balances', () => {
  const b = empty()
  bucketArAging(10, 0, b)
  bucketArAging(10, 0.01, b)
  assert.deepEqual(b, empty())
})

test('bucketArAging maps days to finance buckets', () => {
  const b = empty()
  bucketArAging(0, 10, b)
  bucketArAging(30, 5, b)
  bucketArAging(31, 7, b)
  bucketArAging(90, 3, b)
  bucketArAging(91, 2, b)
  bucketArAging(200, 1, b)
  assert.equal(b.current, 15)
  assert.equal(b.d30, 7)
  assert.equal(b.d60, 3)
  assert.equal(b.d90, 2)
  assert.equal(b.d90p, 1)
})
