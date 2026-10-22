import assert from 'node:assert/strict'
import test from 'node:test'
import { homeFor, isManager, tabsFor } from './mobile-home'

test('each role starts where its work is', () => {
  assert.equal(homeFor('DRIVER'), '/m/delivery')
  assert.equal(homeFor('WAREHOUSE_STAFF'), '/m/warehouse')
  assert.equal(homeFor('SALES_REP'), '/m/sales')
  for (const r of ['MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN', 'ACCOUNTANT', 'VIEWER', 'STAFF', undefined, '']) {
    assert.equal(homeFor(r), '/m/home', String(r))
  }
  assert.equal(homeFor('driver'), '/m/delivery')
})

test('managers are managers, accountants are not', () => {
  assert.equal(isManager('manager'), true)
  assert.equal(isManager('TENANT_ADMIN'), true)
  assert.equal(isManager('ACCOUNTANT'), false)
  assert.equal(isManager(null), false)
})

test('a field role sees only its own area; managers see Home and everything', () => {
  const labels = (role: string, perms: string[] = []) => tabsFor(role, perms).map((t) => t.label)
  assert.deepEqual(labels('DRIVER'), ['Delivery'])
  assert.deepEqual(labels('WAREHOUSE_STAFF'), ['Warehouse'])
  assert.deepEqual(labels('SALES_REP'), ['Sales'])
  assert.deepEqual(labels('MANAGER'), ['Home', 'Warehouse', 'Delivery', 'Sales'])
  assert.deepEqual(labels('TENANT_ADMIN'), ['Home', 'Warehouse', 'Delivery', 'Sales'])
})

test('accountants and viewers get Home, plus any area their permissions grant', () => {
  assert.deepEqual(tabsFor('ACCOUNTANT').map((t) => t.label), ['Home'])
  assert.deepEqual(tabsFor('VIEWER', ['crm.read']).map((t) => t.label), ['Home', 'Sales'])
  assert.deepEqual(tabsFor('DRIVER', ['crm.read']).map((t) => t.label), ['Delivery', 'Sales'])
})
