import assert from 'node:assert/strict'
import test from 'node:test'
import { adminPath } from './admin-path'

test('adminPath adds /admin prefix', () => {
  assert.equal(adminPath('/orders'), '/admin/orders')
  assert.equal(adminPath('orders/abc'), '/admin/orders/abc')
  assert.equal(adminPath('/admin/orders'), '/admin/orders')
})

test('adminPath preserves query strings', () => {
  assert.equal(adminPath('/settings?tab=warehouses'), '/admin/settings?tab=warehouses')
  assert.equal(adminPath('/purchasing?skuId=sku_1'), '/admin/purchasing?skuId=sku_1')
})
