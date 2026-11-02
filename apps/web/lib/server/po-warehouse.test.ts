import assert from 'node:assert/strict'
import test from 'node:test'
import { pickReceivingWarehouse } from './po-warehouse'

test('a warehouse chosen by a person wins over the PO destination and the company default', () => {
  assert.equal(pickReceivingWarehouse({ explicit: 'wh-east', poWarehouseId: 'wh-main', defaultId: 'wh-default' }), 'wh-east')
})

test('with nothing chosen, receiving starts at the PO destination', () => {
  assert.equal(pickReceivingWarehouse({ explicit: undefined, poWarehouseId: 'wh-main', defaultId: 'wh-default' }), 'wh-main')
  assert.equal(pickReceivingWarehouse({ explicit: '', poWarehouseId: 'wh-main' }), 'wh-main')
  assert.equal(pickReceivingWarehouse({ explicit: '   ', poWarehouseId: 'wh-main' }), 'wh-main')
})

test('a PO with no destination falls back to the company default, as before', () => {
  assert.equal(pickReceivingWarehouse({ poWarehouseId: null, defaultId: 'wh-default' }), 'wh-default')
  assert.equal(pickReceivingWarehouse({ poWarehouseId: undefined, defaultId: 'wh-default' }), 'wh-default')
})

test('nothing at all gives null so the caller can report it', () => {
  assert.equal(pickReceivingWarehouse({}), null)
  assert.equal(pickReceivingWarehouse({ explicit: null, poWarehouseId: null, defaultId: null }), null)
})

test('ids are trimmed', () => {
  assert.equal(pickReceivingWarehouse({ explicit: ' wh-east ' }), 'wh-east')
})
