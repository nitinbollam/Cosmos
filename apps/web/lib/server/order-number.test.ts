import assert from 'node:assert/strict'
import test from 'node:test'
import { formatOrderNumber, orderCodeOf, parseOrderNumberQuery, ORDER_NUMBER_START } from './order-number'

test('the first order is ORD-1001', () => {
  assert.equal(formatOrderNumber(ORDER_NUMBER_START + 1), 'ORD-1001')
})

test('a numbered order shows its number, an unnumbered one a stable tail of its id', () => {
  assert.equal(orderCodeOf({ id: 'cmvlc9a6b0000tpyo8x9vkbm7', orderNumber: 1042 }), 'ORD-1042')
  assert.equal(orderCodeOf({ id: 'cmvlc9a6b0000tpyo8x9vkbm7', orderNumber: null }), 'ORD-9VKBM7')
})

test('the search box understands 1042, ord-1042 and #ORD-1042', () => {
  assert.equal(parseOrderNumberQuery('1042'), 1042)
  assert.equal(parseOrderNumberQuery('ord-1042'), 1042)
  assert.equal(parseOrderNumberQuery('#ORD-1042'), 1042)
  assert.equal(parseOrderNumberQuery('  ORD1042 '), 1042)
  assert.equal(parseOrderNumberQuery('acme'), null)
  assert.equal(parseOrderNumberQuery('cmvlc9a6b'), null)
  assert.equal(parseOrderNumberQuery(''), null)
})
