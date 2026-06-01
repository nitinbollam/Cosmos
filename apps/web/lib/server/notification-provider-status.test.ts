import test from 'node:test'
import assert from 'node:assert/strict'
import { getNotificationProviderStatus } from './notification-provider-status'

test('getNotificationProviderStatus returns email and sms providers', () => {
  const status = getNotificationProviderStatus()
  assert.equal(typeof status.email.provider, 'string')
  assert.equal(typeof status.sms.provider, 'string')
  assert.equal(typeof status.setupNote, 'string')
  assert.ok(['console', 'webhook'].includes(status.activeFallback))
})
