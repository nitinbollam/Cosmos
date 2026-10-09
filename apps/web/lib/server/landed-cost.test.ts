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
