import assert from 'node:assert/strict'
import test from 'node:test'
import { actionFor, cleanScan, filterQuery, lineLabel, nextLine, ownerOf, progress, shortQtyProblem, taskTitle, type PickItem } from './warehouse-tasks'

const item = (id: string, status: string, quantity = 2, pickedQty = 0, extra: Partial<PickItem> = {}): PickItem => ({
  id, skuId: `sku-${id}-abcdef`, status, quantity, pickedQty, ...extra,
})

test('the next line is the first one not done, in the order sent', () => {
  const items = [item('a', 'PICKED', 2, 2), item('b', 'SHORT', 3, 1), item('c', 'PENDING'), item('d', 'PENDING')]
  assert.equal(nextLine(items)?.id, 'c')
  assert.equal(nextLine([item('a', 'PICKED', 2, 2)]), null)
  assert.equal(nextLine([]), null)
})

test('progress counts lines and units', () => {
  const items = [item('a', 'PICKED', 2, 2), item('b', 'SHORT', 3, 1), item('c', 'PENDING', 5, 0)]
  assert.deepEqual(progress(items), { done: 2, total: 3, units: 3, unitsTotal: 10 })
})

test('who holds a task and what the button says', () => {
  assert.equal(ownerOf({ assignedUserId: null }, 'u1'), 'free')
  assert.equal(ownerOf({ assignedUserId: 'u1' }, 'u1'), 'mine')
  assert.equal(ownerOf({ assignedUserId: 'u2' }, 'u1'), 'other')
  assert.equal(ownerOf({ assignedUserId: 'u2' }, null), 'other')
  assert.deepEqual(['mine', 'free', 'other'].map((o) => actionFor(o as 'mine' | 'free' | 'other')), ['Continue', 'Claim', 'Taken'])
})

test('filters map to the server query', () => {
  assert.equal(filterQuery('mine'), 'assigned=mine')
  assert.equal(filterQuery('free'), 'assigned=unassigned')
  assert.equal(filterQuery('all'), '')
})

test('labels fall back to the code, then the id', () => {
  assert.equal(lineLabel(item('a', 'PENDING', 1, 0, { skuName: ' Cola 12pk ' })), 'Cola 12pk')
  assert.equal(lineLabel(item('a', 'PENDING', 1, 0, { skuCode: 'COLA' })), 'COLA')
  assert.equal(lineLabel(item('a', 'PENDING')), 'Item …abcdef')
  assert.equal(taskTitle({ orderId: 'order-12345678abcd' }), 'Order #5678ABCD')
})

test('scans are trimmed and blank means none', () => {
  assert.equal(cleanScan('  0123  '), '0123')
  assert.equal(cleanScan('   '), undefined)
})

test('a short count is a whole number from zero to one less than needed', () => {
  assert.equal(shortQtyProblem('0', 5), null)
  assert.equal(shortQtyProblem('4', 5), null)
  assert.match(shortQtyProblem('5', 5)!, /0 to 4/)
  assert.match(shortQtyProblem('', 5)!, /0 to 4/)
  assert.match(shortQtyProblem('1.5', 5)!, /0 to 4/)
  assert.match(shortQtyProblem('-1', 5)!, /0 to 4/)
})
