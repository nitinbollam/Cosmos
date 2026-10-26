import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { ApprovalStatus, ApprovalType } from '@/generated/prisma-tenant'
import type { Role } from '@/generated/prisma-auth'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, purchasingDb, tenantDb } from './db'
import {
  cancelRequisition,
  createRequisition,
  getRequisition,
  submitRequisition,
  updateRequisition,
  withdrawRequisition,
  type Actor,
} from './purchase-requisitions'
import { auditIds, reconcileRequisitionApprovals, setRequisitionFaultForTests, syncRequisition } from './requisition-approval-sync'
import { detailsHash, detailsOf } from './requisition-details'

const PASSWORD = 'requisition-test-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []

type Login = { token: string; actor: Actor }
let mgrA: Login
let mgrB: Login
let admin: Login
let rep: Login
let mgrOtherTenant: Login
let supplierA = ''
let supplierB = ''

async function login(tenantId: string, role: Role): Promise<Login> {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: role, lastName: 'U', role, permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  const { accessToken } = await loginUser(email, PASSWORD)
  return { token: accessToken, actor: { userId: user.id, tenantId, role } }
}

async function call(who: Login, method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${who.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

const decide = (who: Login, approvalId: string, approve: boolean, rejectReason?: string) =>
  call(who, 'POST', `/approvals/${approvalId}/decide`, { approve, rejectReason })

const goodBody = () => ({
  supplierId: supplierA,
  currency: 'usd',
  freightAmount: '12.50',
  lines: [
    { skuCode: 'SKU-1', description: 'Widget', qtyRequested: 10, unitCost: '4.2500' },
    { description: 'Bolt', qtyRequested: 3, unitCost: 0 },
  ],
})

async function submitted(who: Login = mgrA) {
  const r = await createRequisition(who.actor, goodBody())
  const s = await submitRequisition(who.actor, r.id)
  return s
}

const requestsFor = (tenantId: string, subjectId: string) =>
  tenantDb.approvalRequest.findMany({ where: { tenantId, subjectId, type: ApprovalType.PURCHASE_REQUISITION }, orderBy: { createdAt: 'asc' } })
const auditsFor = (tenantId: string, entityId: string) => tenantDb.auditEvent.findMany({ where: { tenantId, entityId } })
const row = (id: string) => purchasingDb.purchaseRequisition.findUniqueOrThrow({ where: { id }, include: { lines: true } })
const failAt = (point: string) =>
  setRequisitionFaultForTests((p) => {
    if (p === point) throw new Error(`injected failure at ${p}`)
  })

before(async () => {
  for (const t of [tenantA, tenantB]) {
    await authDb.tenant.create({ data: { id: t, name: 'Req', slug: `req-${t.slice(-12)}`, settings: {} } })
    await tenantDb.tenantOrganization.create({ data: { id: t, slug: `req-${t.slice(-12)}`, displayName: 'Req', settings: {}, metadata: {} } })
  }
  supplierA = (await purchasingDb.supplier.create({ data: { tenantId: tenantA, code: 'ACME', name: 'Acme' } })).id
  supplierB = (await purchasingDb.supplier.create({ data: { tenantId: tenantB, code: 'ACME', name: 'Acme B' } })).id
  mgrA = await login(tenantA, 'MANAGER')
  mgrB = await login(tenantA, 'MANAGER')
  admin = await login(tenantA, 'TENANT_ADMIN')
  rep = await login(tenantA, 'SALES_REP')
  mgrOtherTenant = await login(tenantB, 'MANAGER')
})

afterEach(() => setRequisitionFaultForTests(null))

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  for (const t of [tenantA, tenantB]) {
    await purchasingDb.purchaseRequisition.deleteMany({ where: { tenantId: t } })
    await purchasingDb.purchaseRequisitionCounter.deleteMany({ where: { tenantId: t } })
    await purchasingDb.supplier.deleteMany({ where: { tenantId: t } })
    await tenantDb.approvalRequest.deleteMany({ where: { tenantId: t } })
    await tenantDb.auditEvent.deleteMany({ where: { tenantId: t } })
    await tenantDb.tenantOrganization.delete({ where: { id: t } }).catch(() => undefined)
    await authDb.tenant.delete({ where: { id: t } }).catch(() => undefined)
  }
})

// ---------------------------------------------------------------- lifecycle

test('create -> edit -> submit -> approve by another manager, through the API', async () => {
  const created = await call(mgrA, 'POST', '/purchase-requisitions', {
    ...goodBody(),
    supplierId: null,
    tenantId: tenantB,
    requestedBy: 'someone-else',
    status: 'APPROVED',
    lines: [{ description: 'Widget', qtyRequested: 10 }],
  })
  assert.equal(created.status, 201)
  const req = created.body
  assert.equal(req.tenantId, tenantA, 'tenant comes from the session')
  assert.equal(req.requestedBy, mgrA.actor.userId, 'requester comes from the session')
  assert.equal(req.status, 'DRAFT')
  assert.match(req.number, /^PR-\d{4,}$/)
  assert.equal(req.currency, 'USD')
  assert.equal(req.lines[0].unitCost, null, 'a draft may omit cost')

  const edited = await call(mgrA, 'PATCH', `/purchase-requisitions/${req.id}`, { supplierId: supplierA, lines: goodBody().lines })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.lines.length, 2)
  assert.deepEqual(edited.body.lines.map((l: { lineNo: number }) => l.lineNo), [1, 2])

  const sub = await call(mgrA, 'POST', `/purchase-requisitions/${req.id}/submit`)
  assert.equal(sub.status, 200)
  assert.equal(sub.body.status, 'PENDING_APPROVAL')
  assert.equal(sub.body.revision, 1)
  const stored = await row(req.id)
  assert.equal(stored.detailsHash, detailsHash(detailsOf(stored)))

  const [ar] = await requestsFor(tenantA, req.id)
  assert.equal(ar.id, stored.approvalRequestId)
  assert.equal(ar.status, 'PENDING')
  assert.equal(ar.requestedBy, mgrA.actor.userId)
  assert.deepEqual(
    { revision: (ar.context as { revision: number }).revision, hash: (ar.context as { detailsHash: string }).detailsHash, total: (ar.context as { total: string }).total },
    { revision: 1, hash: stored.detailsHash, total: '55' },
  )

  const self = await decide(mgrA, ar.id, true)
  assert.equal(self.status, 403, 'the requester cannot approve their own requisition')
  assert.equal((await row(req.id)).status, 'PENDING_APPROVAL')

  const ok = await decide(mgrB, ar.id, true)
  assert.equal(ok.status, 200)
  const approved = await row(req.id)
  assert.equal(approved.status, 'APPROVED')
  assert.equal(approved.approvedBy, mgrB.actor.userId)

  const audits = await auditsFor(tenantA, req.id)
  assert.equal(audits.filter((a) => a.action === 'requisition.submitted').length, 1)
  assert.equal((await auditsFor(tenantA, ar.id)).filter((a) => a.action === 'approval.approved').length, 1)
})

test('every submission needs approval, even a $0 one', async () => {
  const r = await createRequisition(mgrA.actor, { supplierId: supplierA, lines: [{ description: 'Free sample', qtyRequested: 1, unitCost: '0' }] })
  const s = await submitRequisition(mgrA.actor, r.id)
  assert.equal(s.status, 'PENDING_APPROVAL')
  assert.equal((await requestsFor(tenantA, r.id)).length, 1)
})

test('rejected -> revised -> resubmitted asks for a fresh approval of a new revision', async () => {
  const s = await submitted()
  const first = s.approvalRequestId as string
  assert.equal((await decide(mgrB, first, false, 'Too many widgets')).status, 200)
  const rejected = await row(s.id)
  assert.equal(rejected.status, 'REJECTED')
  assert.equal(rejected.rejectReason, 'Too many widgets')

  await updateRequisition(mgrA.actor, s.id, { lines: [{ description: 'Widget', qtyRequested: 5, unitCost: '4.25' }] })
  const again = await submitRequisition(mgrA.actor, s.id)
  assert.equal(again.status, 'PENDING_APPROVAL')
  assert.equal(again.revision, 2)
  assert.notEqual(again.approvalRequestId, first)
  assert.equal(again.rejectReason, null)
  const requests = await requestsFor(tenantA, s.id)
  assert.deepEqual(requests.map((r) => r.status), ['REJECTED', 'PENDING'])
  assert.equal((await decide(mgrB, first, true)).status, 400, 'the old request stays decided')
  assert.equal((await decide(mgrB, again.approvalRequestId as string, true)).status, 200)
  assert.equal((await row(s.id)).status, 'APPROVED')
})

test('invalid transitions are refused and change nothing', async () => {
  const s = await submitted()
  const editPending = await call(mgrA, 'PATCH', `/purchase-requisitions/${s.id}`, { notes: 'sneaky' })
  assert.equal(editPending.status, 409)
  assert.equal((await row(s.id)).notes, null)

  const draft = await createRequisition(mgrA.actor, goodBody())
  assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${draft.id}/withdraw`)).status, 409)

  await decide(mgrB, s.approvalRequestId as string, true)
  assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${s.id}/submit`)).status, 409)
  assert.equal((await call(mgrA, 'PATCH', `/purchase-requisitions/${s.id}`, { notes: 'x' })).status, 409)

  assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${draft.id}/cancel`, { reason: 'Not needed' })).status, 200)
  assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${draft.id}/cancel`)).status, 409)
  assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${draft.id}/submit`)).status, 409)
  assert.equal((await call(mgrA, 'PATCH', `/purchase-requisitions/${draft.id}`, { notes: 'x' })).status, 409)
  assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${draft.id}/withdraw`)).status, 409)
})

test('submission rules: supplier, lines, positive quantity, explicit cost; a refused submit leaves the draft untouched', async () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ lines: goodBody().lines }, /supplier/],
    [{ supplierId: supplierA, lines: [] }, /at least one line/],
    [{ supplierId: supplierA, lines: [{ description: 'x', qtyRequested: 0, unitCost: '1' }] }, /quantity must be more than 0/],
    [{ supplierId: supplierA, lines: [{ description: 'x', qtyRequested: 1 }] }, /unit cost/],
  ]
  for (const [body, msg] of cases) {
    const r = await createRequisition(mgrA.actor, body)
    const res = await call(mgrA, 'POST', `/purchase-requisitions/${r.id}/submit`)
    assert.equal(res.status, 400, String(msg))
    assert.match(res.body.message, msg)
    const after = await row(r.id)
    assert.deepEqual([after.status, after.revision, after.approvalRequestId, after.detailsHash], ['DRAFT', 0, null, null])
    assert.equal((await requestsFor(tenantA, r.id)).length, 0)
  }
})

test('draft validation: costs >= 0 with at most 4 decimals, whole quantities, 3-letter currency', async () => {
  const bad: unknown[] = [
    { lines: [{ description: 'x', qtyRequested: 1, unitCost: '-1' }] },
    { lines: [{ description: 'x', qtyRequested: 1, unitCost: '1.23456' }] },
    { lines: [{ description: 'x', qtyRequested: 1.5 }] },
    { lines: [{ description: 'x', qtyRequested: -1 }] },
    { lines: [{ description: '', qtyRequested: 1 }] },
    { currency: 'DOLLARS' },
    { freightAmount: 'lots' },
    { lines: 'nope' },
  ]
  for (const body of bad) {
    assert.equal((await call(mgrA, 'POST', '/purchase-requisitions', body)).status, 400, JSON.stringify(body))
  }
  const exact = await call(mgrA, 'POST', '/purchase-requisitions', { dutyAmount: '0.0001', lines: [{ description: 'x', qtyRequested: 1, unitCost: '123456789.1234' }] })
  assert.equal(exact.status, 201)
  const stored = await row(exact.body.id)
  assert.equal(stored.lines[0].unitCost?.toFixed(), '123456789.1234')
  assert.equal(stored.dutyAmount.toFixed(), '0.0001')
})

test('numbers are server-generated, sequential per tenant, and unique under concurrent creates', async () => {
  const made = await Promise.all(Array.from({ length: 8 }, () => createRequisition(mgrB.actor, {})))
  const nums = made.map((r) => Number(r.number.slice(3))).sort((a, b) => a - b)
  assert.equal(new Set(nums).size, 8)
  assert.equal(nums[7] - nums[0], 7, 'no gaps')
  const other = await createRequisition(mgrOtherTenant.actor, {})
  assert.equal(other.number, 'PR-1001', 'each tenant has its own sequence')
})

// ---------------------------------------------------------------- access

test('requisition permissions: managers and admins by default, nobody else', async () => {
  assert.equal((await call(rep, 'GET', '/purchase-requisitions')).status, 403)
  assert.equal((await call(rep, 'POST', '/purchase-requisitions', {})).status, 403)
  assert.equal((await call(mgrA, 'GET', '/purchase-requisitions')).status, 200)
  assert.equal((await call(admin, 'GET', '/purchase-requisitions')).status, 200)
})

test('only the requester edits or submits; an admin may withdraw or cancel, another manager may not', async () => {
  const d = await createRequisition(mgrA.actor, goodBody())
  assert.equal((await call(mgrB, 'PATCH', `/purchase-requisitions/${d.id}`, { notes: 'x' })).status, 403)
  assert.equal((await call(admin, 'PATCH', `/purchase-requisitions/${d.id}`, { notes: 'x' })).status, 403)
  assert.equal((await call(mgrB, 'POST', `/purchase-requisitions/${d.id}/submit`)).status, 403)
  assert.equal((await call(admin, 'POST', `/purchase-requisitions/${d.id}/submit`)).status, 403)
  assert.equal((await row(d.id)).status, 'DRAFT')

  await submitRequisition(mgrA.actor, d.id)
  assert.equal((await call(mgrB, 'POST', `/purchase-requisitions/${d.id}/withdraw`)).status, 403)
  assert.equal((await call(mgrB, 'POST', `/purchase-requisitions/${d.id}/cancel`)).status, 403)
  assert.equal((await call(admin, 'POST', `/purchase-requisitions/${d.id}/withdraw`)).status, 200)
  assert.equal((await row(d.id)).status, 'DRAFT')
  assert.equal((await call(admin, 'POST', `/purchase-requisitions/${d.id}/cancel`, { reason: 'Requester left' })).status, 200)
  const c = await row(d.id)
  assert.deepEqual([c.status, c.cancelledBy, c.cancelReason], ['CANCELLED', admin.actor.userId, 'Requester left'])
})

test('an admin who raised a requisition cannot approve it; a rep fails the approver gate; another manager can', async () => {
  const s = await submitted(admin)
  assert.equal((await decide(admin, s.approvalRequestId as string, true)).status, 403)
  assert.equal((await decide(rep, s.approvalRequestId as string, true)).status, 403, 'approver role gate')
  assert.equal((await decide(mgrA, s.approvalRequestId as string, true)).status, 200)
})

test('cross-tenant: another tenant cannot see, change or decide a requisition, nor use its supplier', async () => {
  const s = await submitted()
  assert.equal((await call(mgrOtherTenant, 'GET', `/purchase-requisitions/${s.id}`)).status, 404)
  assert.equal((await call(mgrOtherTenant, 'PATCH', `/purchase-requisitions/${s.id}`, { notes: 'x' })).status, 404)
  assert.equal((await call(mgrOtherTenant, 'POST', `/purchase-requisitions/${s.id}/withdraw`)).status, 404)
  assert.equal((await call(mgrOtherTenant, 'POST', `/purchase-requisitions/${s.id}/cancel`)).status, 404)
  assert.equal((await decide(mgrOtherTenant, s.approvalRequestId as string, true)).status, 404)
  const list = await call(mgrOtherTenant, 'GET', '/purchase-requisitions')
  assert.equal(list.body.some((r: { id: string }) => r.id === s.id), false)
  assert.equal((await row(s.id)).status, 'PENDING_APPROVAL')

  const foreign = await call(mgrA, 'POST', '/purchase-requisitions', { supplierId: supplierB })
  assert.equal(foreign.status, 400)
  assert.match(foreign.body.message, /Unknown supplier/)
  const d = await createRequisition(mgrA.actor, {})
  assert.equal((await call(mgrA, 'PATCH', `/purchase-requisitions/${d.id}`, { supplierId: supplierB })).status, 400)
  assert.equal((await row(d.id)).supplierId, null, 'the refused edit rolled back')
})

// ---------------------------------------------------------------- concurrency

test('concurrent edits and submit: whatever wins, the approved hash matches the stored lines', async () => {
  for (let i = 0; i < 5; i++) {
    const d = await createRequisition(mgrA.actor, goodBody())
    const results = await Promise.allSettled([
      updateRequisition(mgrA.actor, d.id, { lines: [{ description: 'Edited', qtyRequested: 7, unitCost: '1.5' }] }),
      submitRequisition(mgrA.actor, d.id),
      updateRequisition(mgrA.actor, d.id, { freightAmount: '99' }),
    ])
    const r = await row(d.id)
    if (r.status === 'PENDING_APPROVAL') {
      assert.equal(r.detailsHash, detailsHash(detailsOf(r)), 'hash covers exactly what is stored')
      const [ar] = await requestsFor(tenantA, d.id)
      assert.equal((ar.context as { detailsHash: string }).detailsHash, r.detailsHash)
    }
    for (const res of results) {
      if (res.status === 'rejected') assert.equal((res.reason as { status?: number }).status, 409, String(res.reason))
    }
  }
})

test('concurrent submits create exactly one approval request', async () => {
  const d = await createRequisition(mgrA.actor, goodBody())
  await Promise.allSettled(Array.from({ length: 5 }, () => submitRequisition(mgrA.actor, d.id)))
  const r = await row(d.id)
  assert.equal(r.revision, 1)
  const reqs = await requestsFor(tenantA, d.id)
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].id, r.approvalRequestId)
  assert.equal((await auditsFor(tenantA, d.id)).filter((a) => a.action === 'requisition.submitted').length, 1)
})

test('two approvers deciding at once: one decision wins, one audit event, the requisition matches it', async () => {
  const admin2 = admin
  const s = await submitted()
  const id = s.approvalRequestId as string
  const [a, b] = await Promise.all([decide(mgrB, id, true), decide(admin2, id, false, 'No budget')])
  const statuses = [a.status, b.status].sort()
  assert.deepEqual(statuses, [200, 400])
  const ar = await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id } })
  const decisions = (await auditsFor(tenantA, id)).filter((e) => e.action.startsWith('approval.'))
  assert.equal(decisions.length, 1)
  assert.equal((await row(s.id)).status, ar.status === 'APPROVED' ? 'APPROVED' : 'REJECTED')
})

test('withdraw racing an approval: never an approved requisition that was withdrawn', async () => {
  for (let i = 0; i < 5; i++) {
    const s = await submitted()
    const id = s.approvalRequestId as string
    await Promise.allSettled([withdrawRequisition(mgrA.actor, s.id), decide(mgrB, id, true)])
    await reconcileRequisitionApprovals({ tenantId: tenantA })
    const r = await row(s.id)
    const ar = await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id } })
    if (r.status === 'APPROVED') {
      assert.equal(r.approvalRequestId, id)
      assert.equal(ar.status, 'APPROVED')
    } else {
      assert.equal(r.status, 'DRAFT')
      assert.equal(r.approvalRequestId, null)
      assert.notEqual(ar.status, 'PENDING', 'the old request is closed or decided, never left open')
    }
  }
})

test('a request that lost its requisition cannot be decided: it is closed instead', async () => {
  const s = await submitted()
  const id = s.approvalRequestId as string
  failAt('withdraw:after-purchasing')
  await assert.rejects(withdrawRequisition(mgrA.actor, s.id), /injected/)
  setRequisitionFaultForTests(null)
  assert.equal((await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id } })).status, 'PENDING', 'tenant write was lost')

  const res = await decide(mgrB, id, true)
  assert.equal(res.status, 409)
  const ar = await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id } })
  assert.equal(ar.status, 'CANCELLED')
  assert.equal((await row(s.id)).status, 'DRAFT')
  assert.equal((await auditsFor(tenantA, s.id)).filter((a) => a.id === auditIds.withdrawn(id)).length, 1)
})

test('cancel racing recovery of a half-finished submit: no open request survives, one cancel event', async () => {
  const d = await createRequisition(mgrA.actor, goodBody())
  failAt('submit:after-purchasing')
  await assert.rejects(submitRequisition(mgrA.actor, d.id), /injected/)
  setRequisitionFaultForTests(null)
  assert.equal((await requestsFor(tenantA, d.id)).length, 0)

  await Promise.allSettled([cancelRequisition(mgrA.actor, d.id, 'Changed my mind'), syncRequisition(tenantA, d.id), syncRequisition(tenantA, d.id)])
  await reconcileRequisitionApprovals({ tenantId: tenantA })
  await reconcileRequisitionApprovals({ tenantId: tenantA })
  assert.equal((await row(d.id)).status, 'CANCELLED')
  const reqs = await requestsFor(tenantA, d.id)
  assert.ok(reqs.every((r) => r.status === ApprovalStatus.CANCELLED), JSON.stringify(reqs.map((r) => r.status)))
  assert.equal((await auditsFor(tenantA, d.id)).filter((a) => a.action === 'requisition.cancelled').length, 1)
})

// ---------------------------------------------------------------- failures between the databases

test('submit fails after the purchasing write: a retried submit finishes it with the same request id', async () => {
  const d = await createRequisition(mgrA.actor, goodBody())
  failAt('submit:after-purchasing')
  await assert.rejects(submitRequisition(mgrA.actor, d.id), /injected/)
  setRequisitionFaultForTests(null)
  const half = await row(d.id)
  assert.equal(half.status, 'PENDING_APPROVAL')
  assert.ok(half.approvalRequestId)

  const retried = await submitRequisition(mgrA.actor, d.id)
  assert.equal(retried.approvalRequestId, half.approvalRequestId)
  assert.equal(retried.revision, 1, 'a retry is not a new revision')
  await submitRequisition(mgrA.actor, d.id)
  await reconcileRequisitionApprovals({ tenantId: tenantA })
  const reqs = await requestsFor(tenantA, d.id)
  assert.deepEqual(reqs.map((r) => r.id), [half.approvalRequestId])
  assert.equal((await auditsFor(tenantA, d.id)).filter((a) => a.action === 'requisition.submitted').length, 1)
})

test('submit fails after the purchasing write: reading the requisition repairs it (lazy recovery)', async () => {
  const d = await createRequisition(mgrA.actor, goodBody())
  failAt('submit:after-purchasing')
  await assert.rejects(submitRequisition(mgrA.actor, d.id), /injected/)
  setRequisitionFaultForTests(null)
  const got = await call(mgrA, 'GET', `/purchase-requisitions/${d.id}`)
  assert.equal(got.status, 200)
  const reqs = await requestsFor(tenantA, d.id)
  assert.equal(reqs.length, 1)
  assert.equal(reqs[0].id, got.body.approvalRequestId)
  assert.equal((await decide(mgrB, reqs[0].id, true)).status, 200)
  assert.equal((await row(d.id)).status, 'APPROVED')
})

test('the decision commits but copying it to the requisition fails: the reconciler applies it once', async () => {
  const s = await submitted()
  const id = s.approvalRequestId as string
  failAt('decision:before-projection')
  const res = await decide(mgrB, id, true)
  setRequisitionFaultForTests(null)
  assert.equal(res.status, 200, 'the decision itself is recorded')
  assert.equal((await row(s.id)).status, 'PENDING_APPROVAL')

  const first = await reconcileRequisitionApprovals({ tenantId: tenantA })
  assert.ok(first.decisionsApplied >= 1)
  const r = await row(s.id)
  assert.deepEqual([r.status, r.approvedBy], ['APPROVED', mgrB.actor.userId])
  const second = await reconcileRequisitionApprovals({ tenantId: tenantA })
  assert.equal(second.decisionsApplied, 0)
  assert.equal(second.requestsCreated, 0)
  assert.equal((await auditsFor(tenantA, id)).filter((a) => a.action === 'approval.approved').length, 1)
})

test('withdraw / cancel fail after the purchasing write: the reconciler closes the request, repeatably', async () => {
  const w = await submitted()
  failAt('withdraw:after-purchasing')
  await assert.rejects(withdrawRequisition(mgrA.actor, w.id), /injected/)
  const c = await submitted()
  failAt('cancel:after-purchasing')
  await assert.rejects(cancelRequisition(mgrA.actor, c.id, 'Duplicate'), /injected/)
  setRequisitionFaultForTests(null)

  for (let i = 0; i < 3; i++) await reconcileRequisitionApprovals({ tenantId: tenantA })
  const wReq = await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id: w.approvalRequestId as string } })
  const cReq = await tenantDb.approvalRequest.findUniqueOrThrow({ where: { id: c.approvalRequestId as string } })
  assert.equal(wReq.status, 'CANCELLED')
  assert.equal(cReq.status, 'CANCELLED')
  assert.match(cReq.cancelReason ?? '', /cancelled/)
  assert.equal((await auditsFor(tenantA, w.id)).filter((a) => a.action === 'requisition.withdrawn').length, 1)
  assert.equal((await auditsFor(tenantA, c.id)).filter((a) => a.action === 'requisition.cancelled').length, 1)
})

test('the reconciler across all tenants repairs each tenant without crossing them', async () => {
  const a = await createRequisition(mgrA.actor, goodBody())
  const b = await createRequisition(mgrOtherTenant.actor, { supplierId: supplierB, lines: [{ description: 'x', qtyRequested: 1, unitCost: '2' }] })
  failAt('submit:after-purchasing')
  await assert.rejects(submitRequisition(mgrA.actor, a.id), /injected/)
  await assert.rejects(submitRequisition(mgrOtherTenant.actor, b.id), /injected/)
  setRequisitionFaultForTests(null)
  const report = await reconcileRequisitionApprovals()
  assert.equal(report.errors, 0)
  const [ra] = await requestsFor(tenantA, a.id)
  const [rb] = await requestsFor(tenantB, b.id)
  assert.equal(ra.tenantId, tenantA)
  assert.equal(rb.tenantId, tenantB)
  assert.equal((await requestsFor(tenantA, b.id)).length, 0)
})

test('withdraw after approval invalidates it: resubmitting needs a new approval', async () => {
  const s = await submitted()
  const first = s.approvalRequestId as string
  await decide(mgrB, first, true)
  const w = await withdrawRequisition(mgrA.actor, s.id)
  assert.deepEqual([w.status, w.approvalRequestId, w.approvedBy], ['DRAFT', null, null])
  await updateRequisition(mgrA.actor, s.id, { freightAmount: '20' })
  const again = await submitRequisition(mgrA.actor, s.id)
  assert.equal(again.status, 'PENDING_APPROVAL')
  assert.notEqual(again.approvalRequestId, first)
  assert.equal((await reconcileRequisitionApprovals({ tenantId: tenantA })).decisionsApplied, 0, 'the old approval is not reapplied')
  assert.equal((await row(s.id)).status, 'PENDING_APPROVAL')
})

test('details changed behind the protocol (e.g. a direct DB write) block the decision', async () => {
  const s = await submitted()
  const line = (await row(s.id)).lines[0]
  await purchasingDb.purchaseRequisitionLine.update({ where: { id: line.id }, data: { qtyRequested: 999 } })
  const res = await decide(mgrB, s.approvalRequestId as string, true)
  assert.equal(res.status, 409)
  assert.match(res.body.message, /no longer matches/)
  assert.equal((await row(s.id)).status, 'PENDING_APPROVAL')
})

test('getRequisition is tenant-scoped at the service level too', async () => {
  const d = await createRequisition(mgrA.actor, {})
  await assert.rejects(getRequisition(mgrOtherTenant.actor, d.id), (e: unknown) => (e as { status?: number }).status === 404)
})

test('under strict tenant scoping every query of the API flow and the reconciler is tenant-bound and filtered', async () => {
  const { setTenantScopeModeForTests, resetTenantScopeReport, tenantScopeReport } = await import('./tenant-scope')
  setTenantScopeModeForTests('strict')
  resetTenantScopeReport()
  try {
    const created = await call(mgrA, 'POST', '/purchase-requisitions', goodBody())
    assert.equal(created.status, 201)
    const id = created.body.id
    assert.equal((await call(mgrA, 'PATCH', `/purchase-requisitions/${id}`, { notes: 'strict' })).status, 200)
    failAt('submit:after-purchasing')
    assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${id}/submit`)).status, 500)
    setRequisitionFaultForTests(null)
    const got = await call(mgrA, 'GET', `/purchase-requisitions/${id}`)
    assert.equal(got.status, 200)
    assert.equal((await decide(mgrB, got.body.approvalRequestId, true)).status, 200)
    assert.equal((await call(mgrA, 'GET', `/purchase-requisitions/${id}`)).body.status, 'APPROVED')
    assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${id}/withdraw`)).status, 200)
    assert.equal((await call(mgrA, 'POST', `/purchase-requisitions/${id}/cancel`)).status, 200)
    assert.equal((await call(mgrA, 'GET', '/purchase-requisitions?mine=1')).status, 200)
    assert.equal((await reconcileRequisitionApprovals({ tenantId: tenantA })).errors, 0)
    assert.equal((await reconcileRequisitionApprovals()).errors, 0)
    const text = JSON.stringify(tenantScopeReport().violations)
    assert.doesNotMatch(text, /PurchaseRequisition|ApprovalRequest|AuditEvent|Supplier/, text)
  } finally {
    setTenantScopeModeForTests(null)
    setRequisitionFaultForTests(null)
  }
})
