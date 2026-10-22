import assert from 'node:assert/strict'
import test from 'node:test'
import { orderTotals, remainingAfterGiftCard } from './order-totals'
import { money } from './money'

test('ten-cent items add up exactly where a float sum drifts', () => {
  // 3 x 0.1 + 0.2 is 0.5000000000000001 as a float.
  const t = orderTotals([{ quantity: 3, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }], { taxRate: 0 })
  assert.equal(t.linesTotal.toString(), '0.5')
  assert.equal(t.totalAmount.toString(), '0.5')
})

test('tax is rounded once, half up, on the subtotal', () => {
  assert.equal(orderTotals([{ quantity: 1, unitPrice: 0.05 }], { taxRate: 0.1 }).taxAmount.toString(), '0.01') // 0.005 -> 0.01
  assert.equal(orderTotals([{ quantity: 1, unitPrice: 10.05 }], { taxRate: 0.07 }).taxAmount.toString(), '0.7') // 0.7035
  const t = orderTotals([{ quantity: 7, unitPrice: 19.99 }], { taxRate: 0.0725 })
  assert.equal(t.linesTotal.toString(), '139.93')
  assert.equal(t.taxAmount.toString(), '10.14') // 10.144925
  assert.equal(t.totalAmount.toString(), '150.07')
})

test('a discount reduces what tax is charged on and cannot go past the lines', () => {
  const t = orderTotals([{ quantity: 2, unitPrice: 50 }], { discount: 10, taxRate: 0.1 })
  assert.deepEqual([t.discountAmount.toString(), t.subtotal.toString(), t.taxAmount.toString(), t.totalAmount.toString()], ['10', '90', '9', '99'])
  const over = orderTotals([{ quantity: 1, unitPrice: 5 }], { discount: 20, taxRate: 0.1 })
  assert.deepEqual([over.discountAmount.toString(), over.subtotal.toString(), over.taxAmount.toString(), over.totalAmount.toString()], ['5', '0', '0', '0'])
})

test('a free order and a zero or missing discount are fine', () => {
  const t = orderTotals([{ quantity: 4, unitPrice: 0 }], { taxRate: 0.07 })
  assert.equal(t.totalAmount.toString(), '0')
  assert.equal(orderTotals([{ quantity: 1, unitPrice: 3 }], { discount: 0, taxRate: 0 }).discountAmount.toString(), '0')
  assert.equal(orderTotals([{ quantity: 1, unitPrice: 3 }], { discount: -4, taxRate: 0 }).totalAmount.toString(), '3')
})

test('the same cents in any order of lines', () => {
  const lines = [0.1, 0.2, 0.3, 19.99, 0.07, 4.35].map((p) => ({ quantity: 3, unitPrice: p }))
  const a = orderTotals(lines, { taxRate: 0.0725 })
  const b = orderTotals([...lines].reverse(), { taxRate: 0.0725 })
  assert.equal(a.totalAmount.toString(), b.totalAmount.toString())
  assert.equal(a.totalAmount.toString(), a.subtotal.plus(a.taxAmount).toString())
})

test('a gift card covers part, all, or none of the total', () => {
  const total = money('99.99')
  assert.deepEqual(Object.values(remainingAfterGiftCard(total, 40)).map(String), ['40', '59.99'])
  assert.deepEqual(Object.values(remainingAfterGiftCard(total, 500)).map(String), ['99.99', '0'])
  assert.deepEqual(Object.values(remainingAfterGiftCard(total, undefined)).map(String), ['0', '99.99'])
  assert.deepEqual(Object.values(remainingAfterGiftCard(total, 0.1 + 0.2)).map(String), ['0.3', '99.69'])
})
