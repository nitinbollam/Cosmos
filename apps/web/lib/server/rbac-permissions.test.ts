import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AVAILABLE_MODULES,
  MODULE_METADATA,
  permissionsForRole,
  hasPermission,
  assertPermission,
  filterAuthorizedModules,
} from './permissions'
import { ApiError } from './session'

test('AVAILABLE_MODULES includes core ERP modules', () => {
  assert.ok(AVAILABLE_MODULES.includes('inventory'))
  assert.ok(AVAILABLE_MODULES.includes('orders'))
  assert.ok(AVAILABLE_MODULES.includes('purchasing'))
  assert.ok(AVAILABLE_MODULES.includes('wms'))
  assert.ok(AVAILABLE_MODULES.includes('crm'))
  assert.ok(AVAILABLE_MODULES.includes('finance'))
  assert.ok(AVAILABLE_MODULES.includes('compliance'))
  assert.ok(AVAILABLE_MODULES.includes('reports'))
  assert.ok(AVAILABLE_MODULES.includes('settings'))
  assert.ok(MODULE_METADATA.inventory)
  assert.ok(MODULE_METADATA.finance)
})

test('Role defaults: SUPER_ADMIN and TENANT_ADMIN have wildcard *', () => {
  const superAdminPerms = permissionsForRole('SUPER_ADMIN')
  const tenantAdminPerms = permissionsForRole('TENANT_ADMIN')
  assert.deepEqual(superAdminPerms, ['*'])
  assert.deepEqual(tenantAdminPerms, ['*'])

  const adminSession = {
    userId: 'u1',
    email: 'admin@cosmos.local',
    tenantId: 't1',
    role: 'TENANT_ADMIN' as const,
  }

  assert.equal(hasPermission(adminSession, 'inventory.write'), true)
  assert.equal(hasPermission(adminSession, 'finance.write'), true)
  assert.equal(hasPermission(adminSession, 'settings.write'), true)
  assert.doesNotThrow(() => assertPermission(adminSession, 'settings.write'))
})

test('Role defaults: WAREHOUSE_STAFF has inventory and WMS, but not finance or settings', () => {
  const whSession = {
    userId: 'u2',
    email: 'warehouse@cosmos.local',
    tenantId: 't1',
    role: 'WAREHOUSE_STAFF' as const,
  }

  assert.equal(hasPermission(whSession, 'inventory.read'), true)
  assert.equal(hasPermission(whSession, 'inventory.write'), true)
  assert.equal(hasPermission(whSession, 'wms.read'), true)
  assert.equal(hasPermission(whSession, 'wms.write'), true)
  assert.equal(hasPermission(whSession, 'orders.read'), true)

  assert.equal(hasPermission(whSession, 'finance.read'), false)
  assert.equal(hasPermission(whSession, 'finance.write'), false)
  assert.equal(hasPermission(whSession, 'settings.write'), false)

  assert.throws(
    () => assertPermission(whSession, 'finance.write'),
    (err: unknown) => err instanceof ApiError && err.status === 403,
  )
})

test('Role defaults: ACCOUNTANT has finance and reports, but not WMS write', () => {
  const acctSession = {
    userId: 'u3',
    email: 'acct@cosmos.local',
    tenantId: 't1',
    role: 'ACCOUNTANT' as const,
  }

  assert.equal(hasPermission(acctSession, 'finance.read'), true)
  assert.equal(hasPermission(acctSession, 'finance.write'), true)
  assert.equal(hasPermission(acctSession, 'reports.read'), true)
  assert.equal(hasPermission(acctSession, 'purchasing.read'), true)

  assert.equal(hasPermission(acctSession, 'wms.write'), false)
  assert.equal(hasPermission(acctSession, 'settings.write'), false)
})

test('Role defaults: SALES_REP has CRM, quotes, read access to catalog, but not WMS or finance mutations', () => {
  const salesSession = {
    userId: 'u4',
    email: 'sales@cosmos.local',
    tenantId: 't1',
    role: 'SALES_REP' as const,
  }

  assert.equal(hasPermission(salesSession, 'crm.read'), true)
  assert.equal(hasPermission(salesSession, 'crm.write'), true)
  assert.equal(hasPermission(salesSession, 'quotes.read'), true)
  assert.equal(hasPermission(salesSession, 'quotes.write'), true)
  assert.equal(hasPermission(salesSession, 'inventory.read'), true)
  assert.equal(hasPermission(salesSession, 'inventory.write'), false)
  assert.equal(hasPermission(salesSession, 'wms.write'), false)
  assert.equal(hasPermission(salesSession, 'finance.write'), false)
})

test('Custom permissions: Staff user with granular permissions overrides defaults', () => {
  const staffSession = {
    userId: 'u5',
    email: 'staff@cosmos.local',
    tenantId: 't1',
    role: 'STAFF' as const,
    permissions: ['inventory.read', 'orders.read', 'orders.write'],
  }

  // Granted:
  assert.equal(hasPermission(staffSession, 'inventory.read'), true)
  assert.equal(hasPermission(staffSession, 'orders.read'), true)
  assert.equal(hasPermission(staffSession, 'orders.write'), true)

  // Not granted:
  assert.equal(hasPermission(staffSession, 'inventory.write'), false)
  assert.equal(hasPermission(staffSession, 'purchasing.read'), false)
  assert.equal(hasPermission(staffSession, 'finance.read'), false)
  assert.equal(hasPermission(staffSession, 'wms.write'), false)

  assert.throws(
    () => assertPermission(staffSession, 'inventory.write'),
    (err: unknown) => err instanceof ApiError && err.status === 403,
  )
})

test('Custom permissions: Module wildcard matches all sub-actions', () => {
  const staffWithModWildcard = {
    userId: 'u6',
    email: 'custom@cosmos.local',
    tenantId: 't1',
    role: 'STAFF' as const,
    permissions: ['crm.*', 'reports.read'],
  }

  assert.equal(hasPermission(staffWithModWildcard, 'crm.read'), true)
  assert.equal(hasPermission(staffWithModWildcard, 'crm.write'), true)
  assert.equal(hasPermission(staffWithModWildcard, 'crm.customAction'), true)
  assert.equal(hasPermission(staffWithModWildcard, 'reports.read'), true)
  assert.equal(hasPermission(staffWithModWildcard, 'reports.write'), false)
  assert.equal(hasPermission(staffWithModWildcard, 'inventory.read'), false)
})

test('filterAuthorizedModules returns only modules where user has read or write access', () => {
  const staffSession = {
    userId: 'u7',
    email: 'picker@cosmos.local',
    tenantId: 't1',
    role: 'STAFF' as const,
    permissions: ['inventory.read', 'wms.*'],
  }

  const authorized = filterAuthorizedModules(staffSession)
  assert.ok(authorized.includes('inventory'))
  assert.ok(authorized.includes('wms'))
  assert.equal(authorized.includes('finance'), false)
  assert.equal(authorized.includes('compliance'), false)
  assert.equal(authorized.includes('settings'), false)
})
