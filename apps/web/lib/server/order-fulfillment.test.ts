import assert from 'node:assert/strict'
import test from 'node:test'
import { canTransitionOrderStatus, fulfillmentTaskStatusToOrderStatus } from './order-status'

test('Order fulfillment state transitions allow PROCESSING to PACKED and SHIPPED', () => {
  assert.equal(canTransitionOrderStatus('PROCESSING', 'PACKED'), true)
  assert.equal(canTransitionOrderStatus('PROCESSING', 'CANCELLED'), true)
  assert.equal(canTransitionOrderStatus('BACKORDERED', 'PROCESSING'), true)
})

test('Fulfillment task status correctly maps to order status', () => {
  assert.equal(fulfillmentTaskStatusToOrderStatus('PENDING'), 'PROCESSING')
  assert.equal(fulfillmentTaskStatusToOrderStatus('PICKING'), 'PROCESSING')
  assert.equal(fulfillmentTaskStatusToOrderStatus('PACKED'), 'PACKED')
  assert.equal(fulfillmentTaskStatusToOrderStatus('DISPATCHED'), 'SHIPPED')
})
