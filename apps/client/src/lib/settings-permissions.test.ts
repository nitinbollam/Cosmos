import assert from 'node:assert/strict'
import test from 'node:test'
import type { Viewer } from '@/lib/requisitions'
import { settingsActionAllowed, settingsActionReason, type SettingsAction } from './settings-permissions'

const viewer = (role: string, permissions: string[]): Viewer => ({ userId: 'u1', role, permissions }) as unknown as Viewer

const manager = viewer('MANAGER', ['settings.read', 'users.read', 'edi.read', 'inventory.*', 'compliance.*'])
const admin = viewer('TENANT_ADMIN', [])

const ALL: SettingsAction[] = [
  'company', 'onboarding', 'workflow', 'finance', 'features', 'billing', 'salesChannels', 'tax',
  'ageVerification', 'msa', 'users', 'warehouses', 'edi', 'webhooks', 'stripeConnect',
]

test('an administrator may use every Settings action', () => {
  for (const a of ALL) assert.equal(settingsActionAllowed(admin, a), true, a)
})

test('nothing is allowed before the viewer has loaded', () => {
  for (const a of ALL) assert.equal(settingsActionAllowed(undefined, a), false, a)
})

test('a manager keeps the compliance and warehouse actions the server accepts', () => {
  for (const a of ['tax', 'ageVerification', 'msa', 'warehouses'] as const) {
    assert.equal(settingsActionAllowed(manager, a), true, a)
    assert.equal(settingsActionReason(manager, a), null, a)
  }
})

test('a manager cannot use the actions the server refuses', () => {
  for (const a of ['company', 'onboarding', 'workflow', 'finance', 'features', 'billing', 'salesChannels', 'users', 'edi'] as const) {
    assert.equal(settingsActionAllowed(manager, a), false, a)
    assert.match(settingsActionReason(manager, a)!, /view this but not change/, a)
  }
})

test('admin-only actions say so, and a permission alone does not unlock them', () => {
  const everything = viewer('MANAGER', ['*'])
  for (const a of ['webhooks', 'stripeConnect'] as const) {
    assert.equal(settingsActionAllowed(everything, a), false, a)
    assert.match(settingsActionReason(manager, a)!, /administrator/, a)
  }
})

test('the exact write permission unlocks its action', () => {
  assert.equal(settingsActionAllowed(viewer('STAFF', ['users.write']), 'users'), true)
  assert.equal(settingsActionAllowed(viewer('STAFF', ['settings.write']), 'company'), true)
  assert.equal(settingsActionAllowed(viewer('STAFF', ['edi.write']), 'edi'), true)
})
