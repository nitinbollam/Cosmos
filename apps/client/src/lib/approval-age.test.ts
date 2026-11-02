import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countOverdueReason, waitLevel, waitingDays, waitingLabel } from './approval-age'

const now = new Date('2026-11-02T15:00:00')
const ago = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()

test('waiting time reads as hours, then days', () => {
  assert.equal(waitingLabel(ago(0.2), now), 'Just now')
  assert.equal(waitingLabel(ago(1), now), '1 hour')
  assert.equal(waitingLabel(ago(5), now), '5 hours')
  assert.equal(waitingLabel(ago(24), now), '1 day')
  assert.equal(waitingLabel(ago(28 * 24 + 3), now), '28 days')
  assert.equal(waitingDays(ago(-5), now), 0, 'a clock skew into the future is not negative')
})

test('urgency follows the 2-day reminder and 5-day escalation', () => {
  assert.equal(waitLevel(ago(47), now), 'ok')
  assert.equal(waitLevel(ago(48), now), 'reminded')
  assert.equal(waitLevel(ago(5 * 24), now), 'escalated')
})

test('a count is overdue once its scheduled day has passed, or after 2 days waiting for approval', () => {
  assert.equal(countOverdueReason({ status: 'IN_PROGRESS', scheduledFor: '2026-11-02T09:00:00' }, now), null, 'due today is not overdue')
  assert.match(countOverdueReason({ status: 'IN_PROGRESS', scheduledFor: '2026-07-31T09:00:00' }, now) ?? '', /^Overdue: scheduled/)
  assert.equal(countOverdueReason({ status: 'COMPLETED', scheduledFor: '2026-07-31T09:00:00' }, now), null)
  assert.equal(countOverdueReason({ status: 'PENDING_APPROVAL', scheduledFor: null, submittedAt: ago(24) }, now), null)
  assert.equal(countOverdueReason({ status: 'PENDING_APPROVAL', scheduledFor: null, submittedAt: ago(62 * 24) }, now), 'Waiting 62 days for approval')
  assert.equal(
    countOverdueReason({ status: 'PENDING_APPROVAL', scheduledFor: null, submittedAt: null, updatedAt: ago(62 * 24) }, now),
    'Waiting 62 days for approval',
    'counts submitted before submittedAt existed use their last update',
  )
})
