import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import { ApprovalType } from '@/generated/prisma-tenant'
import { purchasingDb, tenantDb } from './db'
import { createRequisition, getRequisition, submitRequisition, withdrawRequisition, type Actor } from './purchase-requisitions'
import {
  deliverRequisitionEvents,
  reconcileRequisitionApprovals,
  resetRequisitionReconcileCursorForTests,
  runRequisitionReconcileJob,
  setRequisitionFaultForTests,
} from './requisition-approval-sync'

// The scheduled requisition reconciler: disable switch, no overlapping runs, bounded batches that resume, and audit
// delivery that one bad event cannot block. Also: actions whose tenant-side follow-up fails still succeed.

const tenantId = `t-${randomUUID()}`
const requester: Actor = { userId: `u-${randomUUID()}`, tenantId, role: 'MANAGER' }
let supplierId = ''

const body = () => ({ supplierId, lines: [{ description: 'Widget', qtyRequested: 2, unitCost: '3.5' }] })
const requestsFor = (subjectId: string) => tenantDb.approvalRequest.findMany({ where: { tenantId, subjectId, type: ApprovalType.PURCHASE_REQUISITION } })
const failAt = (point: string) =>
  setRequisitionFaultForTests((p) => {
    if (p === point) throw new Error(`injected failure at ${p}`)
  })

/** A submitted requisition whose approval request was never created (the tenant write after submit was lost). */
async function halfSubmitted() {
  const r = await createRequisition(requester, body())
  failAt('submit:after-purchasing')
  await assert.rejects(submitRequisition(requester, r.id), /injected/)
  setRequisitionFaultForTests(null)
  return r
}

before(async () => {
  supplierId = (await purchasingDb.supplier.create({ data: { tenantId, code: 'JOB', name: 'Job supplier' } })).id
})
afterEach(() => {
  setRequisitionFaultForTests(null)
  delete process.env.REQUISITION_RECONCILE_DISABLED
})
after(async () => {
  await purchasingDb.purchaseRequisition.deleteMany({ where: { tenantId } })
  await purchasingDb.purchaseRequisitionEvent.deleteMany({ where: { tenantId } })
  await purchasingDb.purchaseRequisitionCounter.deleteMany({ where: { tenantId } })
  await purchasingDb.supplier.deleteMany({ where: { tenantId } })
  await tenantDb.approvalRequest.deleteMany({ where: { tenantId } })
  await tenantDb.auditEvent.deleteMany({ where: { tenantId } })
})

test('REQUISITION_RECONCILE_DISABLED=1 turns the scheduled job off; enabled, it repairs', async () => {
  const r = await halfSubmitted()
  process.env.REQUISITION_RECONCILE_DISABLED = '1'
  assert.equal(await runRequisitionReconcileJob(), null)
  assert.equal((await requestsFor(r.id)).length, 0, 'nothing ran')
  delete process.env.REQUISITION_RECONCILE_DISABLED
  resetRequisitionReconcileCursorForTests()
  let report = await runRequisitionReconcileJob()
  while (report?.more) report = await runRequisitionReconcileJob()
  assert.ok(report)
  assert.equal((await requestsFor(r.id)).length, 1)
})

test('a run that starts while the previous one is still going is skipped', async () => {
  const [a, b] = await Promise.all([runRequisitionReconcileJob(), runRequisitionReconcileJob()])
  assert.equal([a, b].filter((r) => r === null).length, 1)
})

test('batches are bounded and the next run resumes where the last stopped', async () => {
  const made = []
  for (let i = 0; i < 7; i++) made.push(await halfSubmitted())
  resetRequisitionReconcileCursorForTests()
  const first = await reconcileRequisitionApprovals({ batchSize: 2, maxBatches: 1 })
  assert.equal(first.more, true)
  assert.ok(first.requisitionsChecked <= 2, `checked ${first.requisitionsChecked}`)
  // Later runs continue (the shared test database may hold other tenants' rows too, hence the loop).
  for (let i = 0; i < 500; i++) {
    const r = await reconcileRequisitionApprovals({ batchSize: 2, maxBatches: 1 })
    if (!r.more) break
  }
  for (const r of made) assert.equal((await requestsFor(r.id)).length, 1, r.number)
})

test('one audit event that fails to deliver does not block the rest of its tenant', async () => {
  const a = await createRequisition(requester, body())
  const b = await createRequisition(requester, body())
  for (const r of [a, b]) {
    await submitRequisition(requester, r.id)
    failAt('withdraw:after-purchasing')
    await assert.rejects(withdrawRequisition(requester, r.id), /injected/)
    setRequisitionFaultForTests(null)
  }
  let calls = 0
  setRequisitionFaultForTests((p) => {
    if (p === 'events:before-delivery' && ++calls === 1) throw new Error('first delivery fails')
  })
  const first = await deliverRequisitionEvents(tenantId)
  setRequisitionFaultForTests(null)
  assert.deepEqual(first, { written: 1, failed: 1 })
  const delivered = await tenantDb.auditEvent.count({ where: { tenantId, action: 'requisition.withdrawn', entityId: { in: [a.id, b.id] } } })
  assert.equal(delivered, 1, 'the event after the failing one was still delivered')
  assert.deepEqual(await deliverRequisitionEvents(tenantId), { written: 1, failed: 0 }, 'the failed one is retried later')
  assert.equal(await tenantDb.auditEvent.count({ where: { tenantId, action: 'requisition.withdrawn', entityId: { in: [a.id, b.id] } } }), 2)
})

test('withdraw still succeeds when the tenant database fails after the change is saved', async () => {
  const r = await createRequisition(requester, body())
  const s = await submitRequisition(requester, r.id)
  const original = tenantDb.$transaction
  ;(tenantDb as unknown as { $transaction: unknown }).$transaction = () => Promise.reject(new Error('tenant db down'))
  let result
  try {
    result = await withdrawRequisition(requester, r.id)
  } finally {
    ;(tenantDb as unknown as { $transaction: unknown }).$transaction = original
  }
  assert.equal(result.status, 'DRAFT')
  assert.equal((await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id: s.approvalRequestId as string } })).status, 'PENDING', 'not closed yet')
  const read = await getRequisition(requester, r.id)
  assert.equal(read.syncPending, false, 'reading it delivered the withdrawal audit')
  await reconcileRequisitionApprovals({ tenantId })
  assert.equal((await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id: s.approvalRequestId as string } })).status, 'CANCELLED')
})
