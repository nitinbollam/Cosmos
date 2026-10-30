import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertValidPurchaseOrderLines,
  computePurchaseOrderTotal,
  landedCostProblems,
  MAX_PO_LINE_QUANTITY,
  poValidationError,
  purchaseOrderLineProblems,
  purchaseOrderTotals,
} from './purchasing'
import { Prisma } from '@/generated/prisma-purchasing'

const line = (over: Record<string, unknown> = {}) => ({ lineNo: 1, skuCode: 'COLA-12', description: '', qtyOrdered: 10, unitCost: 4.5, ...over })
const refuses = (lines: unknown, message: string) =>
  assert.throws(() => assertValidPurchaseOrderLines(lines), (e: Error & { status?: number }) => e.message === message)

test('a PO line with a SKU, a whole quantity and a unit cost passes; the description is optional', () => {
  assertValidPurchaseOrderLines([line(), line({ lineNo: 2, skuCode: 'CHIPS-6', description: undefined, unitCost: 0 })])
})

test('every line needs a unit cost: missing is refused, 0 is allowed', () => {
  for (const unitCost of [undefined, null]) {
    refuses([line({ unitCost })], 'Line 1: unit cost is required (enter 0 if there is no charge)')
  }
  assertValidPurchaseOrderLines([line({ unitCost: 0 })])
  const problems = purchaseOrderLineProblems([line(), line({ lineNo: 2, skuCode: 'CHIPS-6', unitCost: undefined })])
  assert.deepEqual(problems.map((p) => [p.line, p.field]), [[2, 'unitCost']])
})

test('a PO is worth its lines plus each landed charge once', () => {
  const d = (n: number) => new Prisma.Decimal(n)
  const po = { lines: [{ qtyOrdered: 300, unitCost: d(9) }], freightAmount: d(0), dutyAmount: null, otherLandedAmount: null }
  assert.deepEqual(purchaseOrderTotals(po), { linesTotal: 2700, landedTotal: 0, total: 2700 })
  assert.deepEqual(purchaseOrderTotals({ ...po, lines: [{ qtyOrdered: 300, unitCost: d(0) }], freightAmount: d(2700) }), { linesTotal: 0, landedTotal: 2700, total: 2700 })
  assert.deepEqual(purchaseOrderTotals({ ...po, freightAmount: d(100), dutyAmount: d(50.5), otherLandedAmount: d(0.25) }), { linesTotal: 2700, landedTotal: 150.75, total: 2850.75 })
  assert.deepEqual(purchaseOrderTotals({ ...po, lines: [{ qtyOrdered: 5000, unitCost: null }] }), { linesTotal: 0, landedTotal: 0, total: 0 })
  assert.equal(computePurchaseOrderTotal({ ...po, freightAmount: d(2700) }), 5400)
})

test('a PO needs at least one line', () => {
  refuses([], 'A purchase order needs at least one line')
  refuses(undefined, 'A purchase order needs at least one line')
})

test('a blank or missing SKU code is refused, naming the line', () => {
  refuses([line({ skuCode: '' })], 'Line 1: SKU code is required')
  refuses([line(), line({ lineNo: 2, skuCode: '   ' })], 'Line 2: SKU code is required')
  refuses([line({ skuCode: undefined })], 'Line 1: SKU code is required')
})

test('quantity must be a whole number from 1 to the maximum', () => {
  const msg = `Line 1: quantity must be a whole number from 1 to ${MAX_PO_LINE_QUANTITY}`
  for (const qtyOrdered of [undefined, null, 0, -5, 2.5, '10', Number.NaN, MAX_PO_LINE_QUANTITY + 1]) {
    refuses([line({ qtyOrdered })], msg)
  }
  assertValidPurchaseOrderLines([line({ qtyOrdered: MAX_PO_LINE_QUANTITY })])
})

test('the same SKU on two lines is refused, pointing at the first', () => {
  refuses(
    [line(), line({ lineNo: 2, skuCode: ' COLA-12 ' })],
    'Line 2: SKU COLA-12 is already on line 1; change the quantity there instead',
  )
})

test('duplicate or invalid line numbers and a negative unit cost are refused', () => {
  refuses([line(), line({ skuCode: 'CHIPS-6' })], 'Line 1: duplicate line number')
  refuses([line({ lineNo: 0 })], 'Line 1: line number must be a whole number of 1 or more')
  refuses([line({ unitCost: -1 })], 'Line 1: unit cost must be a number of 0 or more')
  refuses([line({ description: 42 })], 'Line 1: description must be text')
})

test('every problem is reported at once, each with its line and field', () => {
  let caught: (Error & { status?: number; details?: { errors: Array<{ line: number | null; field: string }> } }) | undefined
  try {
    assertValidPurchaseOrderLines([
      line(),
      line({ lineNo: 2, skuCode: 'CHIPS-6', qtyOrdered: 0, unitCost: -1 }),
      line({ lineNo: 3, skuCode: '', qtyOrdered: 2.5 }),
    ])
  } catch (e) {
    caught = e as typeof caught
  }
  assert.equal(caught?.status, 400)
  assert.deepEqual(
    caught?.details?.errors.map((e) => [e.line, e.field]),
    [[2, 'qtyOrdered'], [2, 'unitCost'], [3, 'skuCode'], [3, 'qtyOrdered']],
  )
  assert.match(caught!.message, /Line 2: quantity .*; Line 2: unit cost .*; Line 3: SKU code is required; Line 3: quantity/)
})

test('negative, infinite and oversized unit costs are refused; zero and a normal price pass', () => {
  for (const unitCost of [-0.01, -1000, -Infinity, Infinity, Number.NaN, '4.5', 1_000_000_001]) {
    assert.throws(() => assertValidPurchaseOrderLines([line({ unitCost })]), /Line 1: unit cost must be/, String(unitCost))
  }
  assertValidPurchaseOrderLines([line({ unitCost: 0 }), line({ lineNo: 2, skuCode: 'CHIPS-6', unitCost: 1_000_000_000 })])
})

test('freight, duty and other landed charges must be 0 or more, real numbers', () => {
  assert.deepEqual(landedCostProblems({}), [])
  assert.deepEqual(landedCostProblems({ freightAmount: 0, dutyAmount: 12.5, otherLandedAmount: 3, landedCostNotes: 'x' }), [])
  const bad = landedCostProblems({ freightAmount: -1, dutyAmount: Number.NaN, otherLandedAmount: '5', landedCostNotes: 7 })
  assert.deepEqual(bad.map((p) => [p.line, p.field]), [[null, 'freightAmount'], [null, 'dutyAmount'], [null, 'otherLandedAmount'], [null, 'landedCostNotes']])
  assert.equal(bad[0].message, 'Freight amount must be a number of 0 or more')
  assert.equal(landedCostProblems({ freightAmount: 2_000_000_000 })[0].message, 'Freight amount must be 1000000000 or less')
  assert.equal(landedCostProblems({ freightAmount: null, dutyAmount: undefined }).length, 0)
})

test('a null entry or non-array lines value is refused rather than crashing', () => {
  assert.equal(purchaseOrderLineProblems([null])[0].field, 'lineNo')
  assert.equal(purchaseOrderLineProblems('lines')[0].field, 'lines')
  assert.equal(poValidationError([{ line: null, field: 'lines', message: 'm' }]).status, 400)
})
