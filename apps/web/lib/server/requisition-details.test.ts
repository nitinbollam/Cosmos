import assert from 'node:assert/strict'
import test from 'node:test'
import { Prisma } from '@/generated/prisma-purchasing'
import {
  canonicalDecimal,
  canonicalDetails,
  detailsHash,
  normalizeCurrency,
  parseAmount,
  requisitionTotal,
  submissionProblem,
  type RequisitionDetails,
} from './requisition-details'

const dec = (v: string) => new Prisma.Decimal(v)

function details(over: Partial<RequisitionDetails> = {}): RequisitionDetails {
  return {
    supplierId: 'sup-1',
    currency: 'USD',
    freightAmount: dec('12.5'),
    dutyAmount: dec('0'),
    otherLandedAmount: dec('0'),
    lines: [
      { lineNo: 1, skuCode: 'SKU-1', description: 'Widget', qtyRequested: 10, unitCost: dec('4.25') },
      { lineNo: 2, skuCode: null, description: 'Bolt', qtyRequested: 3, unitCost: dec('0.1') },
    ],
    ...over,
  }
}

test('equivalent Decimals have one canonical form, and nothing is rounded', () => {
  assert.equal(canonicalDecimal(dec('4.2500')), '4.25')
  assert.equal(canonicalDecimal(dec('4.25')), '4.25')
  assert.equal(canonicalDecimal('4.25e0'), '4.25')
  assert.equal(canonicalDecimal(dec('10.000')), '10')
  assert.equal(canonicalDecimal(dec('100')), '100')
  assert.equal(canonicalDecimal(dec('-0')), '0')
  assert.equal(canonicalDecimal(dec('0.0000')), '0')
  assert.equal(canonicalDecimal('1e-7'), '0.0000001')
  assert.equal(canonicalDecimal('0.12345678901234567890123'), '0.12345678901234567890123')
})

test('the hash ignores line order and trailing zeros, and changes with any purchasing detail', () => {
  const base = detailsHash(details())
  const reordered = details()
  reordered.lines = [...reordered.lines].reverse()
  assert.equal(detailsHash(reordered), base)
  const padded = details({ freightAmount: dec('12.5000') })
  padded.lines[0].unitCost = dec('4.2500')
  assert.equal(detailsHash(padded), base)

  const changes: Array<Partial<RequisitionDetails>> = [
    { supplierId: 'sup-2' },
    { currency: 'EUR' },
    { freightAmount: dec('12.51') },
    { dutyAmount: dec('0.0001') },
    { otherLandedAmount: dec('1') },
    { lines: details().lines.slice(0, 1) },
  ]
  for (const c of changes) assert.notEqual(detailsHash(details(c)), base, JSON.stringify(c))
  const qty = details()
  qty.lines[1].qtyRequested = 4
  assert.notEqual(detailsHash(qty), base)
  const unpriced = details()
  unpriced.lines[1].unitCost = null
  assert.notEqual(detailsHash(unpriced), base, 'null cost differs from 0')
  const zero = details()
  zero.lines[1].unitCost = dec('0')
  assert.notEqual(detailsHash(unpriced), detailsHash(zero))
})

test('the canonical form is plain JSON with fixed strings, never floats', () => {
  const json = canonicalDetails(details())
  assert.match(json, /"freight":"12.5"/)
  assert.match(json, /\[1,"SKU-1","Widget",10,"4.25"\]/)
})

test('totals are exact Decimal sums', () => {
  const d = details({ freightAmount: dec('0.2'), lines: [{ lineNo: 1, skuCode: null, description: 'x', qtyRequested: 1, unitCost: dec('0.1') }] })
  assert.equal(requisitionTotal(d), '0.3')
  assert.equal(0.1 + 0.2 === 0.3, false, 'floats would drift')
  assert.equal(requisitionTotal(details()), '55.3')
  const big = details({
    freightAmount: dec('0'),
    lines: Array.from({ length: 500 }, (_, i) => ({ lineNo: i + 1, skuCode: null, description: 'x', qtyRequested: 1_000_000, unitCost: dec('999999999.9999') })),
  })
  assert.equal(requisitionTotal(big), '499999999999950000')
})

test('amounts: exact strings and numbers accepted; anything that would round or is negative refused', () => {
  assert.equal(parseAmount('4.2500', 'x').toFixed(), '4.25')
  assert.equal(parseAmount(4.25, 'x').toFixed(), '4.25')
  assert.equal(parseAmount('0', 'x').toFixed(), '0')
  assert.equal(parseAmount('-0', 'x').toFixed(), '0')
  assert.equal(parseAmount('999999999.9999', 'x').toFixed(), '999999999.9999')
  for (const bad of ['4.25001', '1e9', '1000000000', '-0.01', 'abc', '', 'NaN', 'Infinity', null, {}, true]) {
    assert.throws(() => parseAmount(bad, 'x'), (e: unknown) => (e as { status?: number }).status === 400, String(bad))
  }
})

test('currency must be a 3-letter code', () => {
  assert.equal(normalizeCurrency(' usd '), 'USD')
  for (const bad of ['US', 'USDX', '12A', '', null, 5]) {
    assert.throws(() => normalizeCurrency(bad), (e: unknown) => (e as { status?: number }).status === 400, String(bad))
  }
})

test('submission needs a supplier, lines, positive quantities and explicit costs (0 allowed)', () => {
  assert.equal(submissionProblem(details()), null)
  assert.match(submissionProblem(details({ supplierId: null })) ?? '', /supplier/)
  assert.match(submissionProblem(details({ lines: [] })) ?? '', /at least one line/)
  const zeroQty = details()
  zeroQty.lines[0].qtyRequested = 0
  assert.match(submissionProblem(zeroQty) ?? '', /Line 1: quantity/)
  const noCost = details()
  noCost.lines[1].unitCost = null
  assert.match(submissionProblem(noCost) ?? '', /Line 2: enter a unit cost/)
  const freeLine = details()
  freeLine.lines[1].unitCost = dec('0')
  assert.equal(submissionProblem(freeLine), null)
})
