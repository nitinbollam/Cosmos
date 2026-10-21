import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildReturnLines,
  canClose,
  cashCountProblem,
  countsProblem,
  inspectionProblem,
  outstanding,
} from './van-return-rules'

const lines = buildReturnLines([{ skuId: 'a', quantity: 10 }, { skuId: 'b', quantity: 4 }], [{ skuId: 'a', quantity: 10 }, { skuId: 'c', quantity: 2 }])
const cash = { expectedCents: 4500, countedCents: 4500 }

test('every expected item is on the return; an item the driver did not list counts as zero', () => {
  assert.deepEqual(lines, [
    { skuId: 'a', expected: 10, counted: 10 },
    { skuId: 'b', expected: 4, counted: 0 },
    { skuId: 'c', expected: 0, counted: 2 },
  ])
})

test('counts and cash must be whole, non-negative numbers', () => {
  assert.equal(countsProblem([{ skuId: 'a', quantity: 0 }]), null)
  assert.match(countsProblem([{ skuId: 'a', quantity: -1 }])!, /whole numbers/)
  assert.match(countsProblem([{ skuId: 'a', quantity: 1 }, { skuId: 'a', quantity: 2 }])!, /once/)
  assert.match(countsProblem('x')!, /counted/)
  assert.equal(cashCountProblem(0), null)
  assert.equal(cashCountProblem(45.5), null)
  assert.match(cashCountProblem(-1)!, /Enter/)
  assert.match(cashCountProblem(1.005)!, /cents/)
  assert.match(cashCountProblem('45')!, /Enter/)
})

test('inspection: good plus damaged equals the count for every counted item', () => {
  const ok = [{ skuId: 'a', good: 8, damaged: 2 }, { skuId: 'c', good: 2, damaged: 0 }]
  assert.equal(inspectionProblem(lines, ok), null)
  assert.match(inspectionProblem(lines, [{ skuId: 'a', good: 8, damaged: 1 }, ok[1]])!, /must equal the 10/)
  assert.match(inspectionProblem(lines, [ok[0]])!, /Every counted item/)
  assert.match(inspectionProblem(lines, [...ok, { skuId: 'zzz', good: 0, damaged: 0 }])!, /not on this return/)
  assert.match(inspectionProblem(lines, [ok[0], ok[0]])!, /once/)
})

test('variances stay outstanding until signed off, and a return closes only when none are left', () => {
  assert.deepEqual(outstanding(lines, cash, null), { lines: ['b', 'c'], cash: false })
  assert.equal(canClose('INSPECTED', lines, cash, null), false)
  const res = {
    lines: {
      b: { action: 'WRITE_OFF' as const, quantity: 4, by: 'm', at: 't', note: 'n' },
      c: { action: 'FOUND' as const, quantity: 2, by: 'm', at: 't', note: 'n' },
    },
  }
  assert.equal(canClose('INSPECTED', lines, cash, res), true)
  assert.equal(canClose('COUNTED', lines, cash, res), false)
  const short = { expectedCents: 4500, countedCents: 4000 }
  assert.deepEqual(outstanding(lines, short, res), { lines: [], cash: true })
  assert.equal(canClose('INSPECTED', lines, short, res), false)
  assert.equal(canClose('INSPECTED', lines, short, { ...res, cash: { by: 'm', at: 't', note: 'n' } }), true)
})
