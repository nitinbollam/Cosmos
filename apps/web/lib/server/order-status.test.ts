import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canTransitionOrderStatus,
  fulfillmentTaskStatusToOrderStatus,
  isOrderCancellationEligible,
} from './order-status'

test('canTransitionOrderStatus allows forward fulfillment flow', () => {
  assert.equal(canTransitionOrderStatus('PENDING', 'PROCESSING'), true)
  assert.equal(canTransitionOrderStatus('PENDING', 'BACKORDERED'), true)
  assert.equal(canTransitionOrderStatus('BACKORDERED', 'PROCESSING'), true)
  assert.equal(canTransitionOrderStatus('PROCESSING', 'PACKED'), true)
  assert.equal(canTransitionOrderStatus('PACKED', 'SHIPPED'), true)
  assert.equal(canTransitionOrderStatus('PACKED', 'CANCELLED'), false)
  assert.equal(canTransitionOrderStatus('SHIPPED', 'CANCELLED'), false)
  assert.equal(canTransitionOrderStatus('SHIPPED', 'DELIVERED'), true)
})

test('cancellation is eligible only before packing', () => {
  for (const status of ['PENDING', 'AWAITING_APPROVAL', 'CONFIRMED', 'BACKORDERED', 'PROCESSING']) {
    assert.equal(isOrderCancellationEligible(status), true, status)
  }
  for (const status of ['PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED', 'FAILED']) {
    assert.equal(isOrderCancellationEligible(status), false, status)
  }
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
