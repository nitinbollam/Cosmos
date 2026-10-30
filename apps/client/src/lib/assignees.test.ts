import assert from 'node:assert/strict'
import test from 'node:test'
import { assignableUsers, PICKER_ROLES, ROUTE_DRIVER_ROLES } from './assignees'

const users = [
  { id: 'dan', role: 'DRIVER', isActive: true },
  { id: 'old-driver', role: 'DRIVER', isActive: false },
  { id: 'alex', role: 'STAFF', isActive: true },
  { id: 'wendy', role: 'WAREHOUSE_STAFF', isActive: true },
  { id: 'mia', role: 'MANAGER', isActive: true },
  { id: 'sam', role: 'SALES_REP', isActive: true },
  { id: 'no-role', isActive: true },
]

const ids = (list: Array<{ id: string }>) => list.map((u) => u.id)

test('the driver list offers active drivers only', () => {
  assert.deepEqual(ids(assignableUsers(users, ROUTE_DRIVER_ROLES)), ['dan'])
})

test('the picker list offers active warehouse staff only', () => {
  assert.deepEqual(ids(assignableUsers(users, PICKER_ROLES)), ['wendy'])
})

test('a user with no isActive flag counts as active', () => {
  assert.deepEqual(ids(assignableUsers([{ id: 'dan', role: 'DRIVER' }], ROUTE_DRIVER_ROLES)), ['dan'])
})
