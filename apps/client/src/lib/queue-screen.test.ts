import assert from 'node:assert/strict'
import test from 'node:test'
import type { OfflineAction } from './offline-queue'
import { ageLabel, needsAttention, queueRows } from './queue-screen'

const NOW = Date.parse('2026-10-22T12:00:00Z')
const act = (id: string, status: OfflineAction['status'], minsAgo: number, extra: Partial<OfflineAction> = {}): OfflineAction => ({
  id, type: 'receiving_scan', payload: {}, createdAt: new Date(NOW - minsAgo * 60_000).toISOString(), status, ...extra,
})

test('ages read as people say them', () => {
  assert.equal(ageLabel(new Date(NOW - 10_000).toISOString(), NOW), 'just now')
  assert.equal(ageLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW), '5 min ago')
  assert.equal(ageLabel(new Date(NOW - 3 * 3_600_000).toISOString(), NOW), '3 h ago')
  assert.equal(ageLabel(new Date(NOW - 50 * 3_600_000).toISOString(), NOW), '2 d ago')
})

test('conflicts first, then failures, then waiting; oldest first within each', () => {
  const rows = queueRows(
    [act('w1', 'pending', 30), act('f1', 'failed', 20), act('c2', 'conflict', 5), act('c1', 'conflict', 50), act('w0', undefined, 90)],
    (t) => t,
    NOW,
  )
  assert.deepEqual(rows.map((r) => r.id), ['c1', 'c2', 'f1', 'w0', 'w1'])
  assert.deepEqual(rows.map((r) => r.kind), ['conflict', 'conflict', 'failed', 'waiting', 'waiting'])
  assert.equal(needsAttention(rows), 3)
})

test('the server\'s reason is shown when there is one, plain words otherwise', () => {
  const [a, b] = queueRows([act('a', 'conflict', 1, { lastError: ' Session closed ', attempts: 2 }), act('b', 'failed', 2)], (t) => t.toUpperCase(), NOW)
  assert.equal(a.detail, 'Session closed')
  assert.equal(a.attempts, 2)
  assert.equal(a.label, 'RECEIVING_SCAN')
  assert.match(b.detail, /retry/)
})
