import assert from 'node:assert/strict'
import test from 'node:test'
import { Prisma } from '@/generated/prisma-purchasing'
import { computePurchaseOrderTotal } from './purchasing'
import { computeAmountOff } from './discounts'
import { DiscountScope, DiscountType } from '@/generated/prisma-tenant'

test('computePurchaseOrderTotal includes lines and landed charges', () => {
  const total = computePurchaseOrderTotal({
    freightAmount: new Prisma.Decimal(100),
    dutyAmount: new Prisma.Decimal(50),
    otherLandedAmount: new Prisma.Decimal(0),
    lines: [
      { qtyOrdered: 10, unitCost: new Prisma.Decimal(10) },
      { qtyOrdered: 5, unitCost: new Prisma.Decimal(20) },
    ],
  })
  assert.equal(total, 350)
})

test('computeAmountOff percentage uses order subtotal', () => {
  const off = computeAmountOff(
    { type: DiscountType.PERCENTAGE, scope: DiscountScope.ORDER, amount: new Prisma.Decimal(10) },
    200,
  )
  assert.equal(off, 20)
})

test('computeAmountOff fixed amount caps at subtotal', () => {
  const off = computeAmountOff(
    { type: DiscountType.FIXED_AMOUNT, scope: DiscountScope.ORDER, amount: new Prisma.Decimal(500) },
    120,
  )
  assert.equal(off, 120)
})

test('till variance equals counted cash minus expected', () => {
  const openingFloat = 100
  const cashSales = 250
  const expectedTotal = openingFloat + cashSales
  const closingCount = 400
  const variance = +(closingCount - expectedTotal).toFixed(2)
  assert.equal(variance, 50)
})

test('loyalty reward discounts bypass manager approval threshold', () => {
  const isLoyaltyReward = (code: string) => Boolean(code?.startsWith('LOY-'))
  const thresholdPct = 20
  const orderSubtotal = 100
  const amountOff = 50 // 50% discount
  const pct = (amountOff / orderSubtotal) * 100

  const requiresApprovalRegular = !isLoyaltyReward('SUMMER50') && pct > thresholdPct
  const requiresApprovalLoyalty = !isLoyaltyReward('LOY-REWARD-123') && pct > thresholdPct

  assert.equal(requiresApprovalRegular, true)
  assert.equal(requiresApprovalLoyalty, false)
})

