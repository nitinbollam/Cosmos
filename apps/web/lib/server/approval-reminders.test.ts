import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { authDb, notificationDb, tenantDb } from './db'
import { APPROVAL_TYPE_LABELS, ESCALATE_AFTER_MS, REMIND_AFTER_MS, dueStages, runApprovalReminders } from './approval-reminders'
import { listApprovalRequests } from './approvals'

const tenantId = `t-${randomUUID()}`
const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-11-02T15:00:00Z')
const ids = { admin: '', manager: '', requester: '', inactiveManager: '' }
const email = (role: string) => `${role}-${tenantId.slice(-6)}@example.test`

async function user(role: 'TENANT_ADMIN' | 'MANAGER' | 'STAFF', name: string, isActive = true) {
  const u = await authDb.user.create({
    data: { tenantId, email: email(name), passwordHash: 'x', firstName: name, lastName: 'U', role, permissions: [], isActive },
  })
  return u.id
}

async function approval(ageMs: number, type: 'DISCOUNT' | 'EXPENSE_REPORT' = 'DISCOUNT') {
  return tenantDb.approvalRequest.create({
    data: {
      tenantId,
      type,
      subjectId: randomUUID(),
      requestedBy: ids.requester,
      context: {},
      createdAt: new Date(now.getTime() - ageMs),
    },
  })
}

const sentTo = async (approvalId: string) =>
  (
    await notificationDb.notificationRequest.findMany({
      where: { tenantId, idempotencyKey: { startsWith: `approval:${approvalId}:` } },
      orderBy: { recipient: 'asc' },
    })
  ).map((n) => `${n.templateKey} → ${n.recipient}`)

before(async () => {
  process.env.APPROVAL_REMINDERS_DISABLED = '1'
  await authDb.tenant.create({ data: { id: tenantId, name: 'Appr', slug: `appr-${tenantId.slice(-8)}`, settings: {} } })
  ids.admin = await user('TENANT_ADMIN', 'admin')
  ids.manager = await user('MANAGER', 'manager')
  ids.requester = await user('MANAGER', 'requester')
  ids.inactiveManager = await user('MANAGER', 'gone', false)
})

after(async () => {
  await notificationDb.notificationRequest.deleteMany({ where: { tenantId } })
  await tenantDb.approvalRequest.deleteMany({ where: { tenantId } })
  await authDb.user.deleteMany({ where: { tenantId } })
  await authDb.tenant.deleteMany({ where: { id: tenantId } })
})

test('stages: new → notice, ~2 days → reminder, ~5 days → escalation, only the most urgent one when first seen late', () => {
  const at = (ms: number) => new Date(now.getTime() - ms)
  const fresh = { createdAt: at(DAY / 24), notifiedAt: null, remindedAt: null, escalatedAt: null }
  assert.deepEqual(dueStages(fresh, now), ['requested'])
  assert.deepEqual(dueStages({ ...fresh, notifiedAt: now }, now), [])
  assert.deepEqual(dueStages({ ...fresh, createdAt: at(REMIND_AFTER_MS), notifiedAt: now }, now), ['reminder'])
  assert.deepEqual(dueStages({ ...fresh, createdAt: at(28 * DAY) }, now), ['escalated'])
  assert.deepEqual(dueStages({ ...fresh, createdAt: at(ESCALATE_AFTER_MS), escalatedAt: now }, now), [])
})

test('cancellation requests have a readable approval notification label', () => {
  assert.equal(APPROVAL_TYPE_LABELS.ORDER_CANCELLATION, 'Order cancellation')
})

test('approvers are told, reminded and escalated once each, never the requester or inactive users', async () => {
  const fresh = await approval(60 * 60 * 1000)
  const twoDays = await approval(REMIND_AFTER_MS + DAY / 2, 'EXPENSE_REPORT')
  const stale = await approval(28 * DAY)
  const decided = await approval(10 * DAY)
  await tenantDb.approvalRequest.update({ where: { id: decided.id }, data: { status: 'APPROVED' } })

  const first = await runApprovalReminders(now)
  assert.ok(first.requested >= 1 && first.reminder >= 1 && first.escalated >= 1)

  assert.deepEqual(await sentTo(fresh.id), [`approval.requested → ${email('admin')}`, `approval.requested → ${email('manager')}`])
  assert.deepEqual(await sentTo(twoDays.id), [`approval.reminder → ${email('admin')}`, `approval.reminder → ${email('manager')}`])
  assert.deepEqual(await sentTo(stale.id), [`approval.escalated → ${email('admin')}`])
  assert.deepEqual(await sentTo(decided.id), [])

  const again = await runApprovalReminders(now)
  assert.deepEqual(again, { requested: 0, reminder: 0, escalated: 0 })
  assert.equal((await sentTo(fresh.id)).length, 2, 'a second run sends nothing new')

  // Three days later the fresh one is due its reminder, and only that.
  await runApprovalReminders(new Date(now.getTime() + 3 * DAY))
  assert.deepEqual(
    (await sentTo(fresh.id)).filter((s) => s.startsWith('approval.reminder')),
    [`approval.reminder → ${email('admin')}`, `approval.reminder → ${email('manager')}`],
  )
  const row = await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id: stale.id } })
  assert.ok(row.escalatedAt)
})

test('the pending inbox lists the longest-waiting request first', async () => {
  const rows = await listApprovalRequests(tenantId, { status: 'PENDING' })
  const times = rows.map((r) => r.createdAt.getTime())
  assert.deepEqual(times, [...times].sort((a, b) => a - b))
  const all = await listApprovalRequests(tenantId)
  assert.ok(all[0].createdAt.getTime() >= all[all.length - 1].createdAt.getTime(), 'other views stay newest first')
})
