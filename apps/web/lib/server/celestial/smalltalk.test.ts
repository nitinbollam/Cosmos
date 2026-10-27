import test from 'node:test'
import assert from 'node:assert/strict'
import type { SessionUser } from '../session'
import { smallTalkReply } from './smalltalk'

const ADMIN = { userId: 'u', tenantId: 't', role: 'TENANT_ADMIN', email: 'a@x', permissions: [] } as unknown as SessionUser
const WAREHOUSE = { ...ADMIN, role: 'WAREHOUSE_STAFF' } as SessionUser

test('greetings, thanks and goodbyes get instant replies', () => {
  assert.match(smallTalkReply('hi', ADMIN) ?? '', /^Hi! I'm Celestial/)
  assert.match(smallTalkReply('Good morning!', ADMIN) ?? '', /^Hi!/)
  assert.equal(smallTalkReply('thanks!', ADMIN), "You're welcome! Anything else you'd like to check?")
  assert.match(smallTalkReply("that's all", ADMIN) ?? '', /see you/)
})

test('a greeting or thanks followed by a real question is not small talk', () => {
  assert.equal(smallTalkReply('hi, show pending orders', ADMIN), null)
  assert.equal(smallTalkReply('great, now only the unpaid ones', ADMIN), null)
  assert.equal(smallTalkReply('ok what do we owe', ADMIN), null)
})

test('"what can you do?" lists only lookups this employee can use', () => {
  const admin = smallTalkReply('what can you do?', ADMIN) ?? ''
  assert.match(admin, /best customer/)
  assert.match(admin, /What do we owe/)
  const wh = smallTalkReply('what can you do?', WAREHOUSE) ?? ''
  assert.match(wh, /cable stock/)
  assert.doesNotMatch(wh, /What do we owe|best customer|sales this month/)
})
