import assert from 'node:assert/strict'
import test from 'node:test'
import { allocateLandedCostPerUnit, computeReceivedUnitCost, totalLandedCharges } from './landed-cost'
import { Prisma } from '@/generated/prisma-purchasing'

const po = {
  freightAmount: new Prisma.Decimal(100),
  dutyAmount: new Prisma.Decimal(50),
  otherLandedAmount: new Prisma.Decimal(0),
  lines: [
    { id: 'a', lineNo: 1, qtyOrdered: 10, qtyReceived: 0, unitCost: new Prisma.Decimal(10) },
    { id: 'b', lineNo: 2, qtyOrdered: 5, qtyReceived: 0, unitCost: new Prisma.Decimal(20) },
  ],
}

test('totalLandedCharges sums freight duty and other', () => {
  assert.equal(totalLandedCharges(po), 150)
})

test('allocateLandedCostPerUnit spreads charges by line weight', () => {
  const a = allocateLandedCostPerUnit(po, 'a', 10)
  const b = allocateLandedCostPerUnit(po, 'b', 5)
  assert.ok(a.landedAdderPerUnit > 0)
  assert.ok(b.landedAdderPerUnit > 0)
  assert.equal(Math.round((a.lineLandedTotal + b.lineLandedTotal) * 100) / 100, 150)
})

test('computeReceivedUnitCost adds landed to base', () => {
  const unit = computeReceivedUnitCost(10, po, 'a', 10)
  assert.ok(unit > 10)
})

const freightPo = (qtyReceived = 0, unit = 9, freight = 2700) => ({
  freightAmount: new Prisma.Decimal(freight),
  dutyAmount: null,
  otherLandedAmount: null,
  lines: [{ id: 'l1', lineNo: 1, qtyOrdered: 300, qtyReceived, unitCost: new Prisma.Decimal(unit) }],
})

test('one full receipt carries the whole landed cost: $9 + $2,700 over 300 units = $18 a unit', () => {
  assert.equal(computeReceivedUnitCost(9, freightPo(), 'l1', 300), 18)
})

test('partial receipts each carry the same per-unit landed cost, so the freight is capitalised once in total', () => {
  const first = computeReceivedUnitCost(9, freightPo(0), 'l1', 150)
  const second = computeReceivedUnitCost(9, freightPo(150), 'l1', 150)
  assert.equal(first, 18)
  assert.equal(second, 18)
  // 150 units at 18 twice is 5,400: the 2,700 of goods plus the 2,700 of freight, not 8,100.
  assert.equal(150 * first + 150 * second, 5400)
})

test('the per-unit landed cost does not depend on how many units arrive in a receipt', () => {
  const perUnit = (n: number) => allocateLandedCostPerUnit(freightPo(), 'l1', n).landedAdderPerUnit
  assert.equal(perUnit(1), perUnit(300))
  assert.equal(perUnit(1), 9)
})

test('a $0 line takes the whole landed cost spread over its ordered units', () => {
  assert.equal(computeReceivedUnitCost(0, freightPo(0, 0), 'l1', 100), 9)
})

test('nothing received or no landed charges means no landed cost', () => {
  assert.equal(allocateLandedCostPerUnit(freightPo(), 'l1', 0).landedAdderPerUnit, 0)
  assert.equal(computeReceivedUnitCost(9, freightPo(0, 9, 0), 'l1', 300), 9)
})

test('with two lines each line keeps its own share however it is received', () => {
  const half = allocateLandedCostPerUnit(po, 'a', 5)
  const full = allocateLandedCostPerUnit(po, 'a', 10)
  assert.equal(half.landedAdderPerUnit, full.landedAdderPerUnit)
  assert.equal(Math.round(full.lineLandedTotal * 100) / 100, 75)
})

