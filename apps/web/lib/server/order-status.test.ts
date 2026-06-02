import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canTransitionOrderStatus,
  fulfillmentTaskStatusToOrderStatus,
} from './order-status'

test('canTransitionOrderStatus allows forward fulfillment flow', () => {
  assert.equal(canTransitionOrderStatus('PENDING', 'PROCESSING'), true)
  assert.equal(canTransitionOrderStatus('PROCESSING', 'PACKED'), true)
  assert.equal(canTransitionOrderStatus('PACKED', 'SHIPPED'), true)
  assert.equal(canTransitionOrderStatus('SHIPPED', 'DELIVERED'), true)
})

test('canTransitionOrderStatus blocks invalid jumps', () => {
  assert.equal(canTransitionOrderStatus('PENDING', 'SHIPPED'), false)
  assert.equal(canTransitionOrderStatus('DELIVERED', 'PROCESSING'), false)
})

test('fulfillmentTaskStatusToOrderStatus maps WMS states', () => {
  assert.equal(fulfillmentTaskStatusToOrderStatus('PICKING'), 'PROCESSING')
  assert.equal(fulfillmentTaskStatusToOrderStatus('PACKED'), 'PACKED')
  assert.equal(fulfillmentTaskStatusToOrderStatus('DISPATCHED'), 'SHIPPED')
  assert.equal(fulfillmentTaskStatusToOrderStatus('CANCELLED'), null)
})
