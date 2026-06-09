import assert from 'node:assert/strict'
import test from 'node:test'
import { canTransitionOrderStatus } from './order-status'

test('backorder flow allows partial allocation then processing', () => {
  assert.equal(canTransitionOrderStatus('CONFIRMED', 'BACKORDERED'), true)
  assert.equal(canTransitionOrderStatus('BACKORDERED', 'PROCESSING'), true)
  assert.equal(canTransitionOrderStatus('BACKORDERED', 'CANCELLED'), true)
  assert.equal(canTransitionOrderStatus('BACKORDERED', 'SHIPPED'), false)
})
