import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { ApprovalType } from '@/generated/prisma-tenant'
import type { Role } from '@/generated/prisma-auth'
import { Prisma } from '@/generated/prisma-purchasing'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, ledgerDb, purchasingDb, tenantDb } from './db'
import { createRequisition, submitRequisition, withdrawRequisition, type Actor } from './purchase-requisitions'
import { auditIds, reconcileRequisitionApprovals, setRequisitionFaultForTests } from './requisition-approval-sync'
import { convertRequisition, defaultPoNumber } from './requisition-conversion'

const PASSWORD = 'conversion-test-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []
const TEST_CURRENCY = 'XTS' // ISO 4217 code reserved for testing

type Login = { token: string; actor: Actor }
let mgrA: Login
let mgrB: Login
let admin: Login
let rep: Login
let warehouse: Login
let mgrOther: Login
let supplierA = ''

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

const convert = (who: Login, id: string, body: unknown = {}) => call(who, 'POST', `/purchase-requisitions/${id}/convert`, body)
const decide = (who: Login, approvalId: string, approve: boolean, rejectReason?: string) =>
  call(who, 'POST', `/approvals/${approvalId}/decide`, { approve, rejectReason })

/** 1000 x 4.25 + 12.50 freight = 4262.50: above the default 2500 PO approval threshold. */
const body = (over: Record<string, unknown> = {}) => ({
  supplierId: supplierA,
  freightAmount: '12.50',
  lines: [
    { skuCode: 'SKU-1', description: 'Widget', qtyRequested: 1000, unitCost: '4.2500' },
    { description: 'Sample', qtyRequested: 1, unitCost: '0' },
  ],
  ...over,
})

async function approved(over: Record<string, unknown> = {}, requester: Login = mgrA, approver: Login = mgrB) {
  const r = await createRequisition(requester.actor, body(over))
  const s = await submitRequisition(requester.actor, r.id)
  const d = await decide(approver, s.approvalRequestId as string, true)
  assert.equal(d.status, 200)
  return purchasingDb.purchaseRequisition.findUniqueOrThrow({ where: { id: r.id } })
}

const req = (id: string) => purchasingDb.purchaseRequisition.findUniqueOrThrow({ where: { id } })
const posFor = (requisitionId: string) => purchasingDb.purchaseOrder.findMany({ where: { requisitionId }, include: { lines: true } })
const audits = (entityId: string, action: string) => tenantDb.auditEvent.findMany({ where: { entityId, action } })
const failAt = (point: string) =>
  setRequisitionFaultForTests((p) => {
    if (p === point) throw new Error(`injected failure at ${p}`)
  })

before(async () => {
  for (const t of [tenantA, tenantB]) {
    await authDb.tenant.create({ data: { id: t, name: 'Conv', slug: `conv-${t.slice(-12)}`, settings: {} } })
    await tenantDb.tenantOrganization.create({ data: { id: t, slug: `conv-${t.slice(-12)}`, displayName: 'Conv', settings: {}, metadata: {} } })
  }
  supplierA = (await purchasingDb.supplier.create({ data: { tenantId: tenantA, code: 'ACME', name: 'Acme' } })).id
  mgrA = await login(tenantA, 'MANAGER')
  mgrB = await login(tenantA, 'MANAGER')
  admin = await login(tenantA, 'TENANT_ADMIN')
  rep = await login(tenantA, 'SALES_REP')
  warehouse = await login(tenantA, 'WAREHOUSE_STAFF')
  mgrOther = await login(tenantB, 'MANAGER')
})

afterEach(() => setRequisitionFaultForTests(null))

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await ledgerDb.exchangeRate.deleteMany({ where: { fromCurrency: TEST_CURRENCY } })
  for (const t of [tenantA, tenantB]) {
    await purchasingDb.purchaseOrder.deleteMany({ where: { tenantId: t } })
    await purchasingDb.purchaseRequisition.deleteMany({ where: { tenantId: t } })
    await purchasingDb.purchaseRequisitionEvent.deleteMany({ where: { tenantId: t } })
    await purchasingDb.purchaseRequisitionCounter.deleteMany({ where: { tenantId: t } })
    await purchasingDb.supplier.deleteMany({ where: { tenantId: t } })
    await tenantDb.approvalRequest.deleteMany({ where: { tenantId: t } })
    await tenantDb.auditEvent.deleteMany({ where: { tenantId: t } })
    await tenantDb.tenantOrganization.delete({ where: { id: t } }).catch(() => undefined)
    await authDb.tenant.delete({ where: { id: t } }).catch(() => undefined)
  }
})

// ---------------------------------------------------------------- the happy path

test('an approved requisition converts to a DRAFT PO built from stored data, and submits without threshold approval', async () => {
  const r = await approved()
  const res = await convert(mgrA, r.id)
  assert.equal(res.status, 201)
  const po = res.body
  assert.equal(po.status, 'DRAFT')
  assert.equal(po.number, defaultPoNumber(r.number))
  assert.equal(po.tenantId, tenantA)
  assert.equal(po.supplierId, supplierA)
  assert.equal(po.currency, 'USD')
  assert.equal(po.createdBy, mgrA.actor.userId)
  assert.equal(po.requisitionId, r.id)
  assert.equal(new Prisma.Decimal(po.freightAmount).toFixed(), '12.5')
  assert.deepEqual(
    po.lines.map((l: { lineNo: number; skuCode: string | null; description: string; qtyOrdered: number; unitCost: string }) => [l.lineNo, l.skuCode, l.description, l.qtyOrdered, new Prisma.Decimal(l.unitCost).toFixed()]),
    [[1, 'SKU-1', 'Widget', 1000, '4.25'], [2, null, 'Sample', 1, '0']],
  )
  const after = await req(r.id)
  assert.deepEqual([after.status, after.purchaseOrderId], ['CONVERTED', po.id])

  const conv = await audits(r.id, 'requisition.converted')
  assert.equal(conv.length, 1)
  assert.equal(conv[0].id, auditIds.converted(r.id))
  assert.equal(conv[0].userId, mgrA.actor.userId)
  assert.equal((conv[0].metadata as { purchaseOrderId: string }).purchaseOrderId, po.id)

  const sub = await call(mgrA, 'POST', `/purchase-orders/${po.id}/submit`)
  assert.equal(sub.status, 200)
  assert.equal(sub.body.status, 'SUBMITTED', 'the requisition approval covers it: no PENDING_APPROVAL')
  assert.equal(await tenantDb.approvalRequest.count({ where: { tenantId: tenantA, subjectId: po.id, type: ApprovalType.PURCHASE_ORDER } }), 0)
})

test('a chosen PO number is used; a foreign-currency requisition gets the tenant rate, or is refused without one', async () => {
  const r = await approved()
  const res = await convert(mgrA, r.id, { number: 'PO-CHOSEN-1' })
  assert.equal(res.status, 201)
  assert.equal(res.body.number, 'PO-CHOSEN-1')

  const fx = await approved({ currency: TEST_CURRENCY })
  const refused = await convert(mgrA, fx.id)
  assert.equal(refused.status, 400)
  assert.match(refused.body.message, /No exchange rate/)
  assert.equal((await req(fx.id)).status, 'APPROVED', 'nothing claimed')
  await ledgerDb.exchangeRate.create({ data: { fromCurrency: TEST_CURRENCY, toCurrency: 'USD', rate: new Prisma.Decimal('1.25'), asOfDate: new Date('2020-01-01') } })
  const ok = await convert(mgrA, fx.id)
  assert.equal(ok.status, 201)
  assert.equal(ok.body.currency, TEST_CURRENCY)
  assert.equal(new Prisma.Decimal(ok.body.fxRateToBase).toFixed(), '1.25')
})

// ---------------------------------------------------------------- refusals

test('every state but APPROVED is refused, and nothing is created', async () => {
  const draft = await createRequisition(mgrA.actor, body())
  const pending = await submitRequisition(mgrA.actor, (await createRequisition(mgrA.actor, body())).id)
  const rejected = await submitRequisition(mgrA.actor, (await createRequisition(mgrA.actor, body())).id)
  await decide(mgrB, rejected.approvalRequestId as string, false, 'No')
  const cancelled = await approved()
  await call(mgrA, 'POST', `/purchase-requisitions/${cancelled.id}/cancel`, { reason: 'Gone' })
  const withdrawn = await approved()
  await withdrawRequisition(mgrA.actor, withdrawn.id)
  for (const [label, id, status] of [
    ['DRAFT', draft.id, 'DRAFT'],
    ['PENDING_APPROVAL', pending.id, 'PENDING_APPROVAL'],
    ['REJECTED', rejected.id, 'REJECTED'],
    ['CANCELLED', cancelled.id, 'CANCELLED'],
    ['withdrawn after approval', withdrawn.id, 'DRAFT'],
  ]) {
    const res = await convert(mgrA, id)
    assert.equal(res.status, 409, label)
    assert.equal((await req(id)).status, status, label)
    assert.equal((await posFor(id)).length, 0, label)
  }
})

test('conversion needs purchasing.write and stays inside the tenant', async () => {
  const r = await approved()
  assert.equal((await convert(rep, r.id)).status, 403, 'no purchasing access')
  assert.equal((await convert(warehouse, r.id)).status, 403, 'purchasing.read only')
  assert.equal((await convert(mgrOther, r.id)).status, 404, 'other tenant')
  await assert.rejects(convertRequisition(mgrOther.actor, r.id, {}), (e: unknown) => (e as { status?: number }).status === 404)
  assert.equal((await req(r.id)).status, 'APPROVED')
  assert.equal((await convert(admin, r.id)).status, 201)
})

test('only a PO number may be sent: replacement supplier, lines or costs are refused', async () => {
  const r = await approved()
  for (const payload of [
    { lines: [{ description: 'Gold', qtyRequested: 1, unitCost: '1' }] },
    { supplierId: supplierA },
    { number: 'PO-OK', freightAmount: '0' },
    { tenantId: tenantB },
    { number: '' },
    { number: 'has space' },
    [],
  ]) {
    const res = await convert(mgrA, r.id, payload)
    assert.equal(res.status, 400, JSON.stringify(payload))
  }
  assert.equal((await req(r.id)).status, 'APPROVED')
  assert.equal((await posFor(r.id)).length, 0)
})

test('stale, tampered, self-approved or inconsistent approvals are refused', async () => {
  const cases: Array<[string, (r: Awaited<ReturnType<typeof approved>>) => Promise<unknown>, RegExp]> = [
    [
      'approval for another revision',
      (r) => tenantDb.approvalRequest.update({ where: { id: r.approvalRequestId as string }, data: { context: { revision: r.revision + 1, detailsHash: r.detailsHash } } }),
      /different revision/,
    ],
    [
      'details changed after approval',
      async (r) => {
        const line = await purchasingDb.purchaseRequisitionLine.findFirstOrThrow({ where: { requisitionId: r.id, lineNo: 1 } })
        await purchasingDb.purchaseRequisitionLine.update({ where: { id: line.id }, data: { unitCost: new Prisma.Decimal('0.01') } })
      },
      /no longer match/,
    ],
    [
      'request not actually approved',
      (r) => tenantDb.approvalRequest.update({ where: { id: r.approvalRequestId as string }, data: { status: 'REJECTED' } }),
      /is REJECTED/,
    ],
    [
      'self-approved',
      async (r) => {
        await tenantDb.approvalRequest.update({ where: { id: r.approvalRequestId as string }, data: { decidedBy: r.requestedBy } })
        await purchasingDb.purchaseRequisition.update({ where: { id: r.id }, data: { approvedBy: r.requestedBy } })
      },
      /own requester/,
    ],
    [
      'approver on the requisition disagrees with the request',
      (r) => purchasingDb.purchaseRequisition.update({ where: { id: r.id }, data: { approvedBy: admin.actor.userId } }),
      /disagree/,
    ],
    [
      'request belongs to another subject',
      (r) => tenantDb.approvalRequest.update({ where: { id: r.approvalRequestId as string }, data: { subjectId: 'someone-else' } }),
      /for something else/,
    ],
    [
      'approval request missing',
      (r) => tenantDb.approvalRequest.delete({ where: { id: r.approvalRequestId as string } }),
      /not found/,
    ],
  ]
  for (const [label, tamper, msg] of cases) {
    const r = await approved()
    await tamper(r)
    const res = await convert(mgrA, r.id)
    assert.equal(res.status, 409, label)
    assert.match(res.body.message, msg, label)
    assert.equal((await req(r.id)).status, 'APPROVED', label)
    assert.equal((await posFor(r.id)).length, 0, label)
  }
})

// ---------------------------------------------------------------- races, retries, rollback

test('concurrent conversions create one PO and all return it', async () => {
  const r = await approved()
  const results = await Promise.all(Array.from({ length: 5 }, () => convert(mgrA, r.id)))
  const pos = await posFor(r.id)
  assert.equal(pos.length, 1)
  for (const res of results) {
    assert.ok([200, 201].includes(res.status), String(res.status))
    assert.equal(res.body.id, pos[0].id)
  }
  assert.equal(results.filter((x) => x.status === 201).length, 1)
  assert.equal((await audits(r.id, 'requisition.converted')).length, 1)
})

test('conversion racing withdrawal or cancellation: either a PO or a withdrawn/cancelled requisition, never both', async () => {
  for (let i = 0; i < 4; i++) {
    const w = await approved()
    await Promise.allSettled([convert(mgrA, w.id), withdrawRequisition(mgrA.actor, w.id)])
    const wr = await req(w.id)
    const wpos = await posFor(w.id)
    if (wr.status === 'CONVERTED') assert.equal(wpos.length, 1)
    else assert.deepEqual([wr.status, wpos.length, wr.purchaseOrderId], ['DRAFT', 0, null])

    const c = await approved()
    await Promise.allSettled([convert(mgrA, c.id), call(mgrA, 'POST', `/purchase-requisitions/${c.id}/cancel`, { reason: 'race' })])
    const cr = await req(c.id)
    const cpos = await posFor(c.id)
    if (cr.status === 'CONVERTED') assert.equal(cpos.length, 1)
    else assert.deepEqual([cr.status, cpos.length], ['CANCELLED', 0])
  }
})

test('a retry returns the same PO after checking its link; a different number is refused', async () => {
  const r = await approved()
  const first = await convert(mgrA, r.id, { number: 'PO-RETRY-1' })
  assert.equal(first.status, 201)
  const again = await convert(mgrA, r.id, { number: 'PO-RETRY-1' })
  const bare = await convert(mgrB, r.id)
  assert.deepEqual([again.status, again.body.id], [200, first.body.id])
  assert.deepEqual([bare.status, bare.body.id], [200, first.body.id])
  const other = await convert(mgrA, r.id, { number: 'PO-RETRY-2' })
  assert.equal(other.status, 409)
  assert.match(other.body.message, /already converted to PO-RETRY-1/)

  // A broken reciprocal link is reported, not papered over.
  await purchasingDb.purchaseOrder.update({ where: { id: first.body.id }, data: { requisitionId: 'another' } })
  assert.equal((await convert(mgrA, r.id)).status, 409)
  await purchasingDb.purchaseOrder.update({ where: { id: first.body.id }, data: { requisitionId: r.id } })
})

test('a PO-number collision rolls the whole conversion back', async () => {
  await purchasingDb.purchaseOrder.create({ data: { tenantId: tenantA, supplierId: supplierA, number: 'PO-TAKEN' } })
  const r = await approved()
  const res = await convert(mgrA, r.id, { number: 'PO-TAKEN' })
  assert.equal(res.status, 409)
  assert.match(res.body.message, /already in use/)
  const after = await req(r.id)
  assert.deepEqual([after.status, after.purchaseOrderId], ['APPROVED', null])
  assert.equal((await posFor(r.id)).length, 0)
  assert.equal(await purchasingDb.purchaseRequisitionEvent.count({ where: { requisitionId: r.id, action: 'requisition.converted' } }), 0)
  assert.equal((await convert(mgrA, r.id, { number: 'PO-FREE' })).status, 201)
})

// ---------------------------------------------------------------- audit recovery

test('conversion commits but its audit is not delivered: a retry returns the PO and delivers it once', async () => {
  const r = await approved()
  failAt('convert:after-purchasing')
  const crashed = await convert(mgrA, r.id)
  setRequisitionFaultForTests(null)
  assert.equal(crashed.status, 500)
  const [po] = await posFor(r.id)
  assert.ok(po, 'the PO committed')
  assert.equal((await audits(r.id, 'requisition.converted')).length, 0)

  const retry = await convert(mgrA, r.id)
  assert.deepEqual([retry.status, retry.body.id], [200, po.id])
  assert.equal((await audits(r.id, 'requisition.converted')).length, 1)
  await reconcileRequisitionApprovals({ tenantId: tenantA })
  assert.equal((await audits(r.id, 'requisition.converted')).length, 1)
})

test('audit delivery failing during conversion: the PO is returned, the reconciler delivers the event once with its actor and time', async () => {
  const r = await approved()
  failAt('events:before-delivery')
  const res = await convert(admin, r.id)
  setRequisitionFaultForTests(null)
  assert.equal(res.status, 201)
  assert.equal((await audits(r.id, 'requisition.converted')).length, 0)
  const event = await purchasingDb.purchaseRequisitionEvent.findUniqueOrThrow({ where: { id: auditIds.converted(r.id) } })
  assert.equal(event.deliveredAt, null)

  for (let i = 0; i < 3; i++) await reconcileRequisitionApprovals({ tenantId: tenantA })
  const [audit] = await audits(r.id, 'requisition.converted')
  assert.equal(audit.userId, admin.actor.userId)
  assert.equal(audit.createdAt.getTime(), event.createdAt.getTime())
  assert.equal((await audits(r.id, 'requisition.converted')).length, 1)
  assert.ok((await purchasingDb.purchaseRequisitionEvent.findUniqueOrThrow({ where: { id: event.id } })).deliveredAt)
})

test('a recovered withdrawal audit names who withdrew (here an admin override), not just "system"', async () => {
  const r = await approved()
  failAt('withdraw:after-purchasing')
  await assert.rejects(withdrawRequisition(admin.actor, r.id), /injected/)
  setRequisitionFaultForTests(null)
  await reconcileRequisitionApprovals({ tenantId: tenantA })
  await reconcileRequisitionApprovals({ tenantId: tenantA })
  const w = await audits(r.id, 'requisition.withdrawn')
  assert.equal(w.length, 1)
  assert.equal(w[0].userId, admin.actor.userId)
  assert.equal((w[0].metadata as { previousStatus: string }).previousStatus, 'APPROVED')
})

// ---------------------------------------------------------------- the converted PO

async function convertedPo(over: Record<string, unknown> = {}) {
  const r = await approved(over)
  const res = await convert(mgrA, r.id)
  assert.equal(res.status, 201)
  return { requisition: r, po: res.body as { id: string } }
}

const landed = (poId: string, patch: Record<string, unknown>) => call(mgrA, 'PATCH', `/purchase-orders/${poId}/landed-costs`, patch)

test('landed costs on a converted PO may move between kinds but never total more than approved', async () => {
  const { po } = await convertedPo() // approved landed: 12.50 freight
  assert.equal((await landed(po.id, { freightAmount: 12.51 })).status, 409)
  assert.equal((await landed(po.id, { otherLandedAmount: 0.0001 })).status, 409, 'even a tiny excess')
  assert.equal((await landed(po.id, { freightAmount: 1.23456 })).status, 400, 'more than 4 decimals is refused, not rounded')
  const moved = await landed(po.id, { freightAmount: 5, dutyAmount: 7.5, landedCostNotes: 'split' })
  assert.equal(moved.status, 200)
  assert.deepEqual([new Prisma.Decimal(moved.body.freightAmount).toFixed(), new Prisma.Decimal(moved.body.dutyAmount).toFixed()], ['5', '7.5'])
  assert.equal((await landed(po.id, { freightAmount: 0, dutyAmount: 0 })).status, 200, 'lower is fine')
  assert.equal((await call(mgrA, 'POST', `/purchase-orders/${po.id}/submit`)).body.status, 'SUBMITTED')
  assert.equal((await landed(po.id, { freightAmount: 20 })).status, 409, 'the cap holds after submission too')
})

test('two concurrent partial landed-cost changes cannot combine past the cap', async () => {
  for (let i = 0; i < 3; i++) {
    const { po } = await convertedPo()
    await landed(po.id, { freightAmount: 0 })
    await Promise.allSettled([landed(po.id, { freightAmount: 12.5 }), landed(po.id, { dutyAmount: 12.5 })])
    const row = await purchasingDb.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })
    const sum = new Prisma.Decimal(row.freightAmount.toString()).plus(row.dutyAmount.toString()).plus(row.otherLandedAmount.toString())
    assert.ok(sum.lte('12.5'), sum.toFixed())
  }
})

test('submitting a converted PO re-verifies the approval and the PO itself', async () => {
  const a = await convertedPo()
  const line = await purchasingDb.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: a.po.id, lineNo: 1 } })
  await purchasingDb.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyOrdered: 5000 } })
  const res = await call(mgrA, 'POST', `/purchase-orders/${a.po.id}/submit`)
  assert.equal(res.status, 409)
  assert.match(res.body.message, /line 1 differs/)

  const b = await convertedPo()
  await purchasingDb.purchaseOrder.update({ where: { id: b.po.id }, data: { freightAmount: new Prisma.Decimal('99') } })
  assert.match((await call(mgrA, 'POST', `/purchase-orders/${b.po.id}/submit`)).body.message, /above the 12.5 approved/)

  const c = await convertedPo()
  await tenantDb.approvalRequest.update({ where: { id: c.requisition.approvalRequestId as string }, data: { status: 'REJECTED' } })
  assert.equal((await call(mgrA, 'POST', `/purchase-orders/${c.po.id}/submit`)).status, 409)

  // No PO can claim to be converted through direct creation: it is refused outright and writes nothing.
  const direct = await call(admin, 'POST', '/purchase-orders', {
    supplierId: supplierA,
    number: `PO-D-${randomUUID().slice(0, 6)}`,
    requisitionId: c.requisition.id,
    createdBy: 'forged',
    lines: [{ lineNo: 1, description: 'x', qtyOrdered: 1, unitCost: 1 }],
  })
  assert.equal(direct.status, 405)
  assert.equal((await posFor(c.requisition.id)).length, 1, 'only the converted PO')
  for (const s of [a, b, c]) assert.equal((await purchasingDb.purchaseOrder.findUniqueOrThrow({ where: { id: s.po.id } })).status, 'DRAFT')
})

// ---------------------------------------------------------------- direct creation is closed

test('direct PO creation is refused for every role, after the usual auth checks, and creates nothing', async () => {
  const before = await purchasingDb.purchaseOrder.count({ where: { tenantId: tenantA } })
  const body = { supplierId: supplierA, number: `PO-X-${randomUUID().slice(0, 6)}`, lines: [{ lineNo: 1, description: 'x', qtyOrdered: 1, unitCost: 1 }] }
  for (const who of [mgrA, admin]) {
    const res = await call(who, 'POST', '/purchase-orders', body)
    assert.equal(res.status, 405)
    assert.match(res.body.message, /purchase requisition/)
    assert.match(res.body.message, /\/purchase-requisitions\/\{id\}\/convert/)
  }
  const raw = await handleApiRequest(
    new Request('http://localhost/api/v1/purchase-orders', {
      method: 'POST',
      headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'application/json' },
      body: '{not json',
    }),
  )
  assert.equal(raw.status, 405, 'refused before the body is read')
  assert.equal(raw.headers.get('allow'), 'GET')
  assert.equal((await call(rep, 'POST', '/purchase-orders', body)).status, 403, 'permission check still first')
  const anonymous = await handleApiRequest(
    new Request('http://localhost/api/v1/purchase-orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  )
  assert.equal(anonymous.status, 401, 'authentication still first')
  assert.equal(await purchasingDb.purchaseOrder.count({ where: { tenantId: tenantA } }), before)
  assert.equal((await call(mgrA, 'GET', '/purchase-orders')).status, 200, 'listing is unaffected')
})

test('drop-ship still creates and submits POs without a requisition (documented unresolved bypass)', async () => {
  const { createDropShipPurchaseOrders } = await import('./drop-ship')
  const { orderDb, inventoryDb } = await import('./db')
  const sku = await inventoryDb.sKU.create({ data: { tenantId: tenantA, code: `DS-${randomUUID().slice(0, 6)}`, name: 'Drop item', category: 'Test', cost: new Prisma.Decimal('1'), price: new Prisma.Decimal('2'), imageUrls: [], attributes: {} } })
  const order = await orderDb.order.create({
    data: {
      tenantId: tenantA,
      customerId: 'cust-ds',
      channel: 'B2B_PORTAL',
      paymentMethod: 'NET_TERMS',
      totalAmount: new Prisma.Decimal('4'),
      lineItems: { create: [{ skuId: sku.id, warehouseId: 'wh-ds', quantity: 2, unitPrice: new Prisma.Decimal('2'), fulfillmentType: 'DROP_SHIP', supplierId: supplierA }] },
    },
  })
  try {
    const created = await createDropShipPurchaseOrders(tenantA, order.id)
    assert.equal(created.length, 1)
    const po = await purchasingDb.purchaseOrder.findUniqueOrThrow({ where: { id: created[0].poId } })
    assert.deepEqual([po.status, po.requisitionId], ['SUBMITTED', null])
  } finally {
    await orderDb.orderLineItem.deleteMany({ where: { orderId: order.id } })
    await orderDb.order.delete({ where: { id: order.id } })
    await inventoryDb.sKU.delete({ where: { id: sku.id } })
  }
})

// ---------------------------------------------------------------- existing POs are unchanged

/** A PO that already exists (created before direct creation was closed), as stored data rather than through the API. */
async function existingPo(label: string, qty: number, unitCost: string) {
  return purchasingDb.purchaseOrder.create({
    data: {
      tenantId: tenantA,
      supplierId: supplierA,
      number: `PO-${label}-${randomUUID().slice(0, 6)}`,
      lines: { create: [{ lineNo: 1, description: label, qtyOrdered: qty, unitCost: new Prisma.Decimal(unitCost) }] },
    },
  })
}

test('existing POs keep their workflow: threshold approval, rejection, landed costs, cancel', async () => {
  const big = { body: await existingPo('BIG', 1000, '5') }
  const sub = await call(mgrA, 'POST', `/purchase-orders/${big.body.id}/submit`)
  assert.equal(sub.body.status, 'PENDING_APPROVAL')
  const [ar] = await tenantDb.approvalRequest.findMany({ where: { tenantId: tenantA, subjectId: big.body.id, type: ApprovalType.PURCHASE_ORDER } })
  assert.equal(ar.status, 'PENDING')
  assert.equal((await decide(mgrA, ar.id, true)).status, 403, 'self-approval block')
  assert.equal((await decide(mgrB, ar.id, true)).status, 200)
  assert.equal((await purchasingDb.purchaseOrder.findUniqueOrThrow({ where: { id: big.body.id } })).status, 'SUBMITTED')
  // No requisition cap applies, but the PO's own approved total still does.
  assert.equal((await landed(big.body.id, { freightAmount: 0 })).status, 200, 'no requisition cap: an unchanged total is accepted')
  const raised = await landed(big.body.id, { freightAmount: 999999 })
  assert.equal(raised.status, 400, 'raising past the approved total is refused')
  assert.match(String(raised.body.message), /above the \$5000\.00 it was approved for/)

  const small = { body: await existingPo('SMALL', 1, '10') }
  assert.equal((await call(mgrA, 'POST', `/purchase-orders/${small.body.id}/submit`)).body.status, 'SUBMITTED')

  const rejected = { body: await existingPo('REJ', 1000, '5') }
  await call(mgrA, 'POST', `/purchase-orders/${rejected.body.id}/submit`)
  const [rar] = await tenantDb.approvalRequest.findMany({ where: { tenantId: tenantA, subjectId: rejected.body.id } })
  await decide(mgrB, rar.id, false, 'Too much')
  const back = await purchasingDb.purchaseOrder.findUniqueOrThrow({ where: { id: rejected.body.id } })
  assert.equal(back.status, 'DRAFT')
  assert.match(back.notes ?? '', /Approval rejected: Too much/)

  const cancelled = await call(mgrA, 'POST', `/purchase-orders/${rejected.body.id}/cancel`)
  assert.equal(cancelled.body.status, 'CANCELLED')
})

test('under strict tenant scoping, conversion, submission and landed changes are tenant-bound and filtered', async () => {
  const { setTenantScopeModeForTests, resetTenantScopeReport, tenantScopeReport } = await import('./tenant-scope')
  const r = await approved()
  setTenantScopeModeForTests('strict')
  resetTenantScopeReport()
  try {
    const res = await convert(mgrA, r.id)
    assert.equal(res.status, 201)
    assert.equal((await convert(mgrA, r.id)).status, 200)
    assert.equal((await landed(res.body.id, { freightAmount: 10 })).status, 200)
    assert.equal((await call(mgrA, 'POST', `/purchase-orders/${res.body.id}/submit`)).status, 200)
    assert.equal((await reconcileRequisitionApprovals()).errors, 0)
    const text = JSON.stringify(tenantScopeReport().violations)
    assert.doesNotMatch(text, /PurchaseRequisition|PurchaseOrder|ApprovalRequest|AuditEvent|Supplier/, text)
  } finally {
    setTenantScopeModeForTests(null)
  }
})
