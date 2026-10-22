import assert from 'node:assert/strict'
import { test } from 'node:test'
import { claimable, compareTasks, isManagerRole, isStale, matchesAssigned, parseAssignedFilter, pickAccess } from './pick-claim'

const t0 = new Date('2026-10-21T10:00:00Z')
const mins = (m: number) => new Date(t0.getTime() + m * 60_000)

test('urgent tasks come first, then the oldest', () => {
  const tasks = [
    { id: 'normal-new', priority: 'NORMAL', createdAt: mins(5) },
    { id: 'urgent', priority: 'URGENT', createdAt: mins(9) },
    { id: 'normal-old', priority: 'NORMAL', createdAt: mins(1) },
    { id: 'low', priority: 'LOW', createdAt: mins(0) },
    { id: 'high', priority: 'HIGH', createdAt: mins(8) },
  ]
  assert.deepEqual([...tasks].sort(compareTasks).map((t) => t.id), ['urgent', 'high', 'normal-old', 'normal-new', 'low'])
})

test('filters: mine, unassigned, all; anything else means all', () => {
  assert.equal(parseAssignedFilter('MINE'), 'mine')
  assert.equal(parseAssignedFilter('unassigned'), 'unassigned')
  assert.equal(parseAssignedFilter('whatever'), 'all')
  assert.equal(parseAssignedFilter(null), 'all')
  assert.equal(matchesAssigned('mine', 'u1', 'u1'), true)
  assert.equal(matchesAssigned('mine', 'u2', 'u1'), false)
  assert.equal(matchesAssigned('unassigned', null, 'u1'), true)
  assert.equal(matchesAssigned('unassigned', 'u2', 'u1'), false)
})

test('who may pick: the holder, a manager, or whoever claims a free task', () => {
  assert.equal(pickAccess({ assignedUserId: 'u1' }, { userId: 'u1', role: 'WAREHOUSE_STAFF' }), 'OK')
  assert.equal(pickAccess({ assignedUserId: 'u2' }, { userId: 'u1', role: 'WAREHOUSE_STAFF' }), 'DENIED')
  assert.equal(pickAccess({ assignedUserId: 'u2' }, { userId: 'u1', role: 'MANAGER' }), 'OK')
  assert.equal(pickAccess({ assignedUserId: null }, { userId: 'u1', role: 'WAREHOUSE_STAFF' }), 'CLAIM_FIRST')
  assert.equal(isManagerRole('manager'), true)
  assert.equal(isManagerRole('DRIVER'), false)
})

test('a claim succeeds on a free task, on your own, and on one whose holder has gone quiet', () => {
  const now = mins(40)
  assert.equal(claimable({ assignedUserId: null, updatedAt: t0 }, 'u1', now, 30), true)
  assert.equal(claimable({ assignedUserId: 'u1', updatedAt: t0 }, 'u1', now, 30), true)
  assert.equal(claimable({ assignedUserId: 'u2', updatedAt: mins(20) }, 'u1', now, 30), false)
  assert.equal(claimable({ assignedUserId: 'u2', updatedAt: t0 }, 'u1', now, 30), true)
  assert.equal(claimable({ assignedUserId: 'u2', updatedAt: t0 }, 'u1', now, 0), false)
  assert.equal(isStale(t0, mins(30), 30), false)
  assert.equal(isStale(t0, mins(31), 30), true)
})
