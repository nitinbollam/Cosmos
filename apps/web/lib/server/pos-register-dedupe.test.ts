import assert from 'node:assert/strict'
import test from 'node:test'
import { planRegisterDedupe, type RegisterRow } from './pos-register-dedupe'

const day = (n: number) => new Date(Date.UTC(2026, 9, n))
const reg = (id: string, name: string, created: number, tenantId = 't1', isActive = true): RegisterRow => ({
  id, tenantId, name, isActive, createdAt: day(created),
})

test('registers with distinct names are left alone', () => {
  assert.deepEqual(planRegisterDedupe([reg('a', 'Register 1', 1), reg('b', 'Register 2', 2)], new Set()), [])
})

test('unused duplicates are deactivated; the oldest stays', () => {
  const plan = planRegisterDedupe(
    [reg('a', 'Register 4', 1), reg('b', 'Register 4', 2), reg('c', 'Register 4', 3)],
    new Set(),
  )
  assert.deepEqual(plan.map((p) => [p.kind, p.id]), [['deactivate', 'b'], ['deactivate', 'c']])
})

test('a used register wins over an older unused one, which is deactivated', () => {
  const plan = planRegisterDedupe([reg('old', 'Register 2', 1), reg('used', 'Register 2', 5)], new Set(['used']))
  assert.deepEqual(plan.map((p) => [p.kind, p.id]), [['deactivate', 'old']])
})

test('a duplicate with history is renamed, never deactivated', () => {
  const plan = planRegisterDedupe(
    [reg('a', 'Register 2', 1), reg('b', 'Register 2', 2), reg('c', 'Register 2', 3)],
    new Set(['a', 'b']),
  )
  assert.deepEqual(plan, [
    { kind: 'rename', id: 'b', tenantId: 't1', name: 'Register 2', newName: 'Register 2 (2)' },
    { kind: 'deactivate', id: 'c', tenantId: 't1', name: 'Register 2' },
  ])
})

test('a new name never collides with an existing one', () => {
  const plan = planRegisterDedupe(
    [reg('a', 'Register 2', 1), reg('b', 'Register 2', 2), reg('x', 'Register 2 (2)', 3)],
    new Set(['a', 'b']),
  )
  assert.equal((plan[0] as { newName: string }).newName, 'Register 2 (3)')
})

test('names match ignoring case and spacing, and companies are separate', () => {
  const plan = planRegisterDedupe(
    [reg('a', 'Front  Till', 1), reg('b', ' front till', 2), reg('c', 'Front Till', 1, 't2')],
    new Set(),
  )
  assert.deepEqual(plan.map((p) => [p.kind, p.id, p.tenantId]), [['deactivate', 'b', 't1']])
})

test('already-inactive registers are ignored', () => {
  assert.deepEqual(planRegisterDedupe([reg('a', 'Register 1', 1), reg('b', 'Register 1', 2, 't1', false)], new Set()), [])
})
