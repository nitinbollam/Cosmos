import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeState, vanLinesProblem, vanSaleRefusal } from './van-rules'

const van = { assignedDriverId: 'd1', stateCode: 'FL', isActive: true }
const customer: { vanSalesApproved: boolean; primaryState: string | null } = { vanSalesApproved: true, primaryState: 'FL' }

test('an approved customer in the van\'s state, served by the van\'s driver, may buy', () => {
  assert.equal(vanSaleRefusal({ van, driverId: 'd1', customer }), null)
  assert.equal(vanSaleRefusal({ van, driverId: 'd1', customer: { ...customer, primaryState: ' fl ' } }), null)
})

test('each rule refuses with its own reason', () => {
  const code = (v = van, d = 'd1', c = customer) => vanSaleRefusal({ van: v, driverId: d, customer: c })?.code
  assert.equal(code({ ...van, isActive: false }), 'VAN_INACTIVE')
  assert.equal(code(van, 'other'), 'NOT_YOUR_VAN')
  assert.equal(code(van, 'd1', { ...customer, vanSalesApproved: false }), 'NOT_APPROVED')
  assert.equal(code(van, 'd1', { ...customer, primaryState: 'GA' }), 'WRONG_STATE')
  assert.equal(code(van, 'd1', { ...customer, primaryState: null }), 'NO_STATE')
  assert.equal(code({ ...van, stateCode: null }), 'NO_STATE')
})

test('states must be two letters', () => {
  assert.equal(normalizeState('fl'), 'FL')
  assert.equal(normalizeState('Florida'), null)
  assert.equal(normalizeState(''), null)
})

test('van lines are whole positive quantities, once per item', () => {
  assert.equal(vanLinesProblem([{ skuId: 'a', quantity: 2 }]), null)
  assert.match(vanLinesProblem([])!, /at least one/i)
  assert.match(vanLinesProblem([{ skuId: 'a', quantity: 0 }])!, /whole numbers/i)
  assert.match(vanLinesProblem([{ skuId: 'a', quantity: 1 }, { skuId: 'a', quantity: 1 }])!, /once/i)
})
