import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cancelRefusal,
  completionRefusal,
  expiryCutoff,
  isExpiredEmptySession,
  RECEIVING_SESSION_EXPIRY_HOURS,
} from './receiving-session-rules'

test('only an open or in-progress session can be completed', () => {
  assert.equal(completionRefusal('OPEN'), null)
  assert.equal(completionRefusal('IN_PROGRESS'), null)
})

test('every finished state refuses a second completion, the discrepancy one included', () => {
  for (const status of ['COMPLETED', 'DISCREPANCY', 'CLOSED']) {
    assert.equal(completionRefusal(status), 'Session already completed', status)
  }
})

test('a cancelled session cannot be completed', () => {
  assert.match(completionRefusal('CANCELLED')!, /cancelled/)
})

test('an open or in-progress session can be cancelled; a finished or cancelled one cannot', () => {
  assert.equal(cancelRefusal('OPEN'), null)
  assert.equal(cancelRefusal('IN_PROGRESS'), null)
  assert.match(cancelRefusal('CANCELLED')!, /already cancelled/)
  for (const status of ['COMPLETED', 'DISCREPANCY', 'CLOSED']) {
    assert.match(cancelRefusal(status)!, /already completed/, status)
  }
})

test('the expiry cutoff is 24 hours back', () => {
  const now = new Date('2026-11-05T12:00:00Z')
  assert.equal(RECEIVING_SESSION_EXPIRY_HOURS, 24)
  assert.equal(expiryCutoff(now).toISOString(), '2026-11-04T12:00:00.000Z')
  assert.equal(expiryCutoff(now, 1).toISOString(), '2026-11-05T11:00:00.000Z')
})

test('only an old, open session with nothing scanned expires', () => {
  const now = new Date('2026-11-05T12:00:00Z')
  const old = new Date('2026-11-04T11:59:00Z')
  const fresh = new Date('2026-11-05T11:00:00Z')
  assert.equal(isExpiredEmptySession({ status: 'OPEN', createdAt: old, anyScanned: false }, now), true)
  assert.equal(isExpiredEmptySession({ status: 'IN_PROGRESS', createdAt: old, anyScanned: false }, now), true)
  assert.equal(isExpiredEmptySession({ status: 'OPEN', createdAt: old, anyScanned: true }, now), false)
  assert.equal(isExpiredEmptySession({ status: 'OPEN', createdAt: fresh, anyScanned: false }, now), false)
  assert.equal(isExpiredEmptySession({ status: 'COMPLETED', createdAt: old, anyScanned: false }, now), false)
  assert.equal(isExpiredEmptySession({ status: 'CANCELLED', createdAt: old, anyScanned: false }, now), false)
})
