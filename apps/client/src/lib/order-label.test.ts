import assert from 'node:assert/strict'
import test from 'node:test'
import { orderLabel } from './order-label'

test('a numbered order shows its number, whatever its id looks like', () => {
  assert.equal(orderLabel('cmvlc9a6b0000tpyo8x9vkbm7', 1042), 'ORD-1042')
  assert.equal(orderLabel(undefined, 1001), 'ORD-1001')
  assert.equal(orderLabel('seed_ord_pending', 1003), 'ORD-1003')
})

test('an order without a number falls back to one consistent tail of its id', () => {
  assert.equal(orderLabel('cmvlc9a6b0000tpyo8x9vkbm7'), 'ORD-9VKBM7')
  assert.equal(orderLabel('cmvlc9a6b0000tpyo8x9vkbm7', null), 'ORD-9VKBM7')
  assert.equal(orderLabel('seed_ord_pending'), 'ORD-PENDING')
})

test('nothing to show for an empty id', () => {
  assert.equal(orderLabel(''), '')
  assert.equal(orderLabel(null), '')
})

test('number zero is still a number', () => {
  assert.equal(orderLabel('abc123', 0), 'ORD-0')
})
