import assert from 'node:assert/strict'
import test from 'node:test'
import { computeSalesTax } from './compliance-tax'
import { orderIdFromStopAddress } from './dispatch-order'
import { netTermsExposure } from './credit-limit'

test('computeSalesTax applies 7% rate', () => {
  assert.equal(computeSalesTax(100), 7)
  assert.equal(computeSalesTax(0), 0)
})

test('orderIdFromStopAddress reads orderId from address JSON', () => {
  assert.equal(orderIdFromStopAddress({ orderId: 'ord_123' }), 'ord_123')
  assert.equal(orderIdFromStopAddress({ line1: 'x' }), null)
})

test('netTermsExposure is total minus paid', () => {
  assert.equal(netTermsExposure(100, 40), 60)
  assert.equal(netTermsExposure(100, 120), 0)
})
