import assert from 'node:assert/strict'
import test from 'node:test'
import { requisitionSkuKeyAction, selectSkuForRequisitionLine } from './requisition-sku-picker'

test('SKU picker arrow keys move through options and wrap at each end', () => {
  assert.deepEqual(requisitionSkuKeyAction('ArrowDown', -1, 3, true), { type: 'move', index: 0 })
  assert.deepEqual(requisitionSkuKeyAction('ArrowDown', 2, 3, true), { type: 'move', index: 0 })
  assert.deepEqual(requisitionSkuKeyAction('ArrowUp', -1, 3, true), { type: 'move', index: 2 })
  assert.deepEqual(requisitionSkuKeyAction('ArrowUp', 0, 3, true), { type: 'move', index: 2 })
  assert.equal(requisitionSkuKeyAction('ArrowDown', -1, 0, true), null)
})

test('Enter selects the active SKU and Escape closes an open list', () => {
  assert.deepEqual(requisitionSkuKeyAction('Enter', 1, 3, true), { type: 'select', index: 1 })
  assert.equal(requisitionSkuKeyAction('Enter', -1, 3, true), null)
  assert.deepEqual(requisitionSkuKeyAction('Escape', -1, 3, true), { type: 'close' })
  assert.equal(requisitionSkuKeyAction('Escape', -1, 3, false), null)
})

test('selecting a SKU fills only an empty description and keeps an entered description verbatim', () => {
  const sku = { code: 'SKU-1', name: 'Catalog description' }
  assert.deepEqual(
    selectSkuForRequisitionLine({ skuCode: 'OLD', description: 'My custom description' }, sku),
    { skuCode: 'SKU-1', description: 'My custom description' },
  )
  assert.deepEqual(selectSkuForRequisitionLine({ skuCode: '', description: '' }, sku), {
    skuCode: 'SKU-1',
    description: 'Catalog description',
  })
})
