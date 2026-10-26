import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ApprovalStatus, ApprovalType } from '@/generated/prisma-tenant'
import { tenantDb } from './db'
import { cancelApprovalRequest, createApprovalRequest, decideApprovalRequest, getApprovalRequest } from './approvals'
import { onApprovalDecided } from './approval-hooks'

// Shared approval code changed for requisitions: decisions are now conditional and written with their audit event in
// one transaction, and requests can be closed as CANCELLED. These pin the behaviour every approval type relies on.

const tenant = () => `t-${randomUUID()}`
const request = (tenantId: string, type: ApprovalType = ApprovalType.PURCHASE_ORDER) =>
  createApprovalRequest(tenantId, { type, subjectId: `s-${randomUUID()}`, requestedBy: 'requester', context: { total: 5400 } })
const decisionAudits = (tenantId: string, id: string) =>
  tenantDb.auditEvent.findMany({ where: { tenantId, entityId: id, action: { in: ['approval.approved', 'approval.rejected'] } } })

test('a decision and its audit event are written together, exactly once', async () => {
  const tenantId = tenant()
  const req = await request(tenantId)
  const decided = await decideApprovalRequest(tenantId, req.id, { approve: false, decidedBy: 'mgr', rejectReason: ' Over budget ' })
  assert.deepEqual([decided.status, decided.decidedBy, decided.rejectReason], ['REJECTED', 'mgr', 'Over budget'])
  const audits = await decisionAudits(tenantId, req.id)
  assert.equal(audits.length, 1)
  assert.equal(audits[0].action, 'approval.rejected')
  assert.equal((audits[0].metadata as { subjectId: string }).subjectId, req.subjectId)
})

test('two approvers at once: one wins, the other gets "already decided", one audit event', async () => {
  for (const type of [ApprovalType.PURCHASE_ORDER, ApprovalType.DISCOUNT, ApprovalType.EXPENSE_REPORT]) {
    const tenantId = tenant()
    const req = await request(tenantId, type)
    const results = await Promise.allSettled([
      decideApprovalRequest(tenantId, req.id, { approve: true, decidedBy: 'mgr-1' }),
      decideApprovalRequest(tenantId, req.id, { approve: false, decidedBy: 'mgr-2', rejectReason: 'No' }),
      decideApprovalRequest(tenantId, req.id, { approve: true, decidedBy: 'mgr-3' }),
    ])
    const won = results.filter((r) => r.status === 'fulfilled')
    assert.equal(won.length, 1, type)
    for (const r of results) {
      if (r.status === 'rejected') {
        assert.equal((r.reason as { status?: number }).status, 400)
        assert.match((r.reason as Error).message, /already decided/)
      }
    }
    const final = await getApprovalRequest(tenantId, req.id)
    assert.equal(final.decidedBy, (won[0] as PromiseFulfilledResult<{ decidedBy: string }>).value.decidedBy)
    assert.equal((await decisionAudits(tenantId, req.id)).length, 1)
  }
})

test('the self-approval block still applies, and nothing is written when it fires', async () => {
  const tenantId = tenant()
  const req = await request(tenantId)
  await assert.rejects(decideApprovalRequest(tenantId, req.id, { approve: true, decidedBy: 'requester' }), (e: unknown) => (e as { status?: number }).status === 403)
  assert.equal((await getApprovalRequest(tenantId, req.id)).status, 'PENDING')
  assert.equal((await decisionAudits(tenantId, req.id)).length, 0)
})

test('a cancelled request cannot be decided, and cancelling never overwrites a decision', async () => {
  const tenantId = tenant()
  const open = await request(tenantId)
  assert.equal(await cancelApprovalRequest(tenantId, open.id, { cancelReason: 'Withdrawn' }), true)
  const closed = await getApprovalRequest(tenantId, open.id)
  assert.deepEqual([closed.status, closed.cancelReason, closed.decidedBy], ['CANCELLED', 'Withdrawn', null])
  await assert.rejects(decideApprovalRequest(tenantId, open.id, { approve: true, decidedBy: 'mgr' }), /cancelled/)
  assert.equal(await cancelApprovalRequest(tenantId, open.id, { cancelReason: 'again' }), false)

  const decided = await request(tenantId)
  await decideApprovalRequest(tenantId, decided.id, { approve: true, decidedBy: 'mgr' })
  assert.equal(await cancelApprovalRequest(tenantId, decided.id, { cancelReason: 'late' }), false)
  assert.equal((await getApprovalRequest(tenantId, decided.id)).status, 'APPROVED')
})

test("cancelApprovalRequest's audit event is written once however often it is retried", async () => {
  const tenantId = tenant()
  const req = await request(tenantId)
  const audit = { id: `test-cancel-${req.id}`, action: 'test.cancelled', entityType: 'Test', entityId: req.id }
  for (let i = 0; i < 3; i++) await cancelApprovalRequest(tenantId, req.id, { cancelReason: 'x', audit })
  assert.equal(await tenantDb.auditEvent.count({ where: { tenantId, id: audit.id } }), 1)
})

test('decision hooks ignore a CANCELLED request of any type (expense reports used to treat it as a rejection)', async () => {
  const tenantId = tenant()
  for (const type of Object.values(ApprovalType)) {
    const req = await request(tenantId, type)
    await cancelApprovalRequest(tenantId, req.id, { cancelReason: 'closed' })
    await onApprovalDecided(tenantId, await getApprovalRequest(tenantId, req.id))
  }
  // Control: the same unknown expense report, when decided, does reach the expense-report side effect.
  const live = await request(tenantId, ApprovalType.EXPENSE_REPORT)
  const decided = await decideApprovalRequest(tenantId, live.id, { approve: false, decidedBy: 'mgr', rejectReason: 'No' })
  await assert.rejects(onApprovalDecided(tenantId, decided))
})

test('pending requests are still listed and found for their subject as before', async () => {
  const tenantId = tenant()
  const req = await request(tenantId)
  const { findPendingApprovalForSubject, listApprovalRequests } = await import('./approvals')
  assert.equal((await findPendingApprovalForSubject(tenantId, ApprovalType.PURCHASE_ORDER, req.subjectId))?.id, req.id)
  assert.deepEqual((await listApprovalRequests(tenantId, { status: ApprovalStatus.PENDING })).map((r) => r.id), [req.id])
})
