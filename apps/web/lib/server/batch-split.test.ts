import assert from 'node:assert/strict'
import { test } from 'node:test'
import { leadingUnits, splitAcrossBatches } from './batch-split'

const d = (s: string) => new Date(s)

test('first to expire goes first, unlabelled stock last', () => {
  const r = splitAcrossBatches(
    [
      { batchId: '', available: 50, expiry: null },
      { batchId: 'B-late', available: 10, expiry: d('2027-06-01') },
      { batchId: 'B-soon', available: 4, expiry: d('2027-01-01') },
      { batchId: 'B-none', available: 5, expiry: null },
    ],
    20,
  )
  assert.deepEqual(r.takes, [
    { batchId: 'B-soon', quantity: 4 },
    { batchId: 'B-late', quantity: 10 },
    { batchId: 'B-none', quantity: 5 },
    { batchId: '', quantity: 1 },
  ])
  assert.equal(r.short, 0)
})

test('what the lots cannot cover is reported, and a recalled lot stays off a van going out only', () => {
  const levels = [
    { batchId: 'OK', available: 3, expiry: d('2027-03-01') },
    { batchId: 'BAD', available: 9, expiry: d('2027-01-01'), recalled: true },
  ]
  const out = splitAcrossBatches(levels, 8, { skipRecalled: true })
  assert.deepEqual(out.takes, [{ batchId: 'OK', quantity: 3 }])
  assert.equal(out.short, 5)
  const back = splitAcrossBatches(levels, 8)
  assert.deepEqual(back.takes, [{ batchId: 'BAD', quantity: 8 }])
  assert.equal(back.short, 0)
})

test('the damaged units come off the front of the plan', () => {
  const plan = [{ batchId: 'A', quantity: 3 }, { batchId: 'B', quantity: 4 }]
  assert.deepEqual(leadingUnits(plan, 5), [{ batchId: 'A', quantity: 3 }, { batchId: 'B', quantity: 2 }])
  assert.deepEqual(leadingUnits(plan, 0), [])
})
