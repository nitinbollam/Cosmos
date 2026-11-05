/**
 * Ticket #3, phase 3A: request-approval, approve and reject only apply to the exact quote version they read.
 * A competing change between the read and the write is slotted in deterministically with the race hook.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, storefrontDb, tenantDb } from './db'
import { setQuoteRaceHookForTests, type QuoteRacePoint } from './quotes'

const PASSWORD = 'quote-concurrency-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
const buyerEmail = `buyer-${randomUUID().slice(0, 6)}@example.test`
const otherBuyerEmail = `other-${randomUUID().slice(0, 6)}@example.test`
const skuCode = `CC-${randomUUID().slice(0, 5)}`
let customerId = ''
let otherCustomerId = ''

async function makeUser(key: string, tenantId: string, role: 'STAFF' | 'MANAGER', email = `${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`) {
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role, permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  uid[key] = user.id
  tok[key] = (await loginUser(email, PASSWORD)).accessToken
}

async function call(key: string, method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${tok[key]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> }
}

async function makeTenant(id: string) {
  await authDb.tenant.create({ data: { id, name: 'C', slug: `c-${id.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id, slug: `c-${id.slice(-8)}`, displayName: 'C', settings: { salesTaxRate: 0 }, metadata: {} },
  })
}

const row = (id: string) => storefrontDb.b2BQuote.findUniqueOrThrow({ where: { id } })

async function openQuote(): Promise<string> {
  const res = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [{ lineNo: 1, skuCode, description: 'Pens', qty: 2, unitPrice: 20 }] })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body.id as string
}

async function pendingQuote(): Promise<string> {
  const id = await openQuote()
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  return id
}

/** Runs `competing` once, the first time the transition under test reaches `point` (nested calls pass through). */
function onceAt(point: QuoteRacePoint, competing: () => Promise<void>) {
  let fired = false
  setQuoteRaceHookForTests(async (p) => {
    if (p !== point || fired) return
    fired = true
    await competing()
  })
  return () => fired
}

before(async () => {
  await makeTenant(tenantA)
  await makeTenant(tenantB)
  customerId = (await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Buyer Co', email: buyerEmail } })).id
  otherCustomerId = (await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Other Co', email: otherBuyerEmail } })).id
  await inventoryDb.sKU.create({
    data: { tenantId: tenantA, code: skuCode, name: 'Pens', category: 'Office', cost: new Prisma.Decimal('9'), price: new Prisma.Decimal('24'), imageUrls: [], attributes: {} },
  })
  await makeUser('buyer', tenantA, 'STAFF', buyerEmail)
  await makeUser('otherBuyer', tenantA, 'STAFF', otherBuyerEmail)
  await makeUser('m1', tenantA, 'MANAGER')
  await makeUser('m2', tenantA, 'MANAGER')
  await makeUser('mB', tenantB, 'MANAGER')
  assert.ok(otherCustomerId)
})

afterEach(() => setQuoteRaceHookForTests(null))

after(async () => {
  setQuoteRaceHookForTests(null)
  for (const t of [tenantA, tenantB]) {
    await storefrontDb.b2BQuote.deleteMany({ where: { tenantId: t } })
    await inventoryDb.sKU.deleteMany({ where: { tenantId: t } })
    await crmDb.customer.deleteMany({ where: { tenantId: t } })
  }
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
  await authDb.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
})

// ---- 1-4: the happy paths, each moving the version by exactly one ----

test('submit for approval: OPEN → PENDING_APPROVAL, version 0 → 1', async () => {
  const id = await openQuote()
  assert.equal((await row(id)).version, 0)
  const res = await call('buyer', 'POST', `/quotes/${id}/request-approval`)
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'PENDING_APPROVAL')
  assert.equal(res.body.version, 1)
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.rejectionReason], ['PENDING_APPROVAL', 1, null])
})

test('approval: PENDING_APPROVAL → APPROVED with server-set approver and time, version +1', async () => {
  const id = await pendingQuote()
  const res = await call('m1', 'POST', `/quotes/${id}/approve`, {})
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.approvedByUserId, q.rejectionReason], ['APPROVED', 2, uid.m1, null])
  assert.ok(q.approvedAt instanceof Date)
})

test('rejection: PENDING_APPROVAL → REJECTED with the reason, version +1', async () => {
  const id = await pendingQuote()
  const res = await call('m1', 'POST', `/quotes/${id}/reject`, { reason: '  Price too low  ' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.rejectionReason, q.approvedByUserId], ['REJECTED', 2, 'Price too low', null])
})

test('the version goes up by one on every transition, including a resubmission after rejection', async () => {
  const id = await openQuote()
  const seen = [(await row(id)).version]
  await call('buyer', 'POST', `/quotes/${id}/request-approval`)
  seen.push((await row(id)).version)
  await call('m1', 'POST', `/quotes/${id}/reject`, { reason: 'No' })
  seen.push((await row(id)).version)
  await call('buyer', 'POST', `/quotes/${id}/request-approval`)
  const resubmitted = await row(id)
  seen.push(resubmitted.version)
  assert.equal(resubmitted.rejectionReason, null, 'resubmitting clears the rejection reason, as before')
  await call('m1', 'POST', `/quotes/${id}/approve`)
  seen.push((await row(id)).version)
  assert.deepEqual(seen, [0, 1, 2, 3, 4])
})

// ---- 5-7: races, made deterministic with the hook ----

test('two approvals of one quote: the second one to write gets 409 and changes nothing', async () => {
  const id = await pendingQuote()
  let inner = 0
  const fired = onceAt('approve:after-read', async () => {
    inner = (await call('m2', 'POST', `/quotes/${id}/approve`)).status
  })
  const outer = await call('m1', 'POST', `/quotes/${id}/approve`)
  assert.ok(fired())
  assert.equal(inner, 200)
  assert.equal(outer.status, 409, JSON.stringify(outer.body))
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.approvedByUserId], ['APPROVED', 2, uid.m2], 'one approval, one version step, the winner recorded')
})

test('two approvals sent at the same moment: exactly one succeeds', async () => {
  const id = await pendingQuote()
  const results = await Promise.all([call('m1', 'POST', `/quotes/${id}/approve`), call('m2', 'POST', `/quotes/${id}/approve`)])
  const statuses = results.map((r) => r.status).sort()
  assert.equal(statuses.filter((s) => s === 200).length, 1, `statuses ${statuses}`)
  assert.ok([400, 409].includes(statuses.find((s) => s !== 200)!), `loser answers 409 (lost the write) or 400 (read it already approved): ${statuses}`)
  const q = await row(id)
  assert.deepEqual([q.status, q.version], ['APPROVED', 2])
})

test('approval racing a rejection: the rejection lands first, the approval gets 409', async () => {
  const id = await pendingQuote()
  onceAt('approve:after-read', async () => {
    assert.equal((await call('m2', 'POST', `/quotes/${id}/reject`, { reason: 'Stock issue' })).status, 200)
  })
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 409)
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.rejectionReason, q.approvedByUserId, q.approvedAt], ['REJECTED', 2, 'Stock issue', null, null])
})

test('rejection racing an approval: the approval lands first, the rejection gets 409', async () => {
  const id = await pendingQuote()
  onceAt('reject:after-read', async () => {
    assert.equal((await call('m2', 'POST', `/quotes/${id}/approve`)).status, 200)
  })
  assert.equal((await call('m1', 'POST', `/quotes/${id}/reject`, { reason: 'Too late' })).status, 409)
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.rejectionReason, q.approvedByUserId], ['APPROVED', 2, null, uid.m2])
})

test('submission vs approval: a quote rejected and resubmitted while the approver looked is not approved (same status, new version)', async () => {
  const id = await pendingQuote()
  onceAt('approve:after-read', async () => {
    assert.equal((await call('m2', 'POST', `/quotes/${id}/reject`, { reason: 'Fix qty' })).status, 200)
    assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  })
  const approve = await call('m1', 'POST', `/quotes/${id}/approve`)
  assert.equal(approve.status, 409, 'status is PENDING_APPROVAL again, but it is not the version the approver checked')
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.approvedByUserId], ['PENDING_APPROVAL', 3, null])
})

test('two submissions for approval at once: the second one to write gets 409', async () => {
  const id = await openQuote()
  onceAt('request-approval:after-read', async () => {
    assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 409)
  const q = await row(id)
  assert.deepEqual([q.status, q.version], ['PENDING_APPROVAL', 1])
})

// ---- 8: the approver's own view ----

test('approve and reject with a stale expectedVersion get 409 and change nothing; the current version works', async () => {
  const id = await pendingQuote()
  const before = await row(id)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`, { expectedVersion: before.version - 1 })).status, 409)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/reject`, { reason: 'x', expectedVersion: before.version + 5 })).status, 409)
  const unchanged = await row(id)
  assert.deepEqual([unchanged.status, unchanged.version], ['PENDING_APPROVAL', before.version])
  const ok = await call('m1', 'POST', `/quotes/${id}/approve`, { expectedVersion: before.version })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal((await row(id)).version, before.version + 1)
})

test('a malformed expectedVersion is a 400', async () => {
  const id = await pendingQuote()
  for (const bad of ['1', -1, 1.5, true]) {
    assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`, { expectedVersion: bad })).status, 400, `approve ${JSON.stringify(bad)}`)
    assert.equal((await call('m1', 'POST', `/quotes/${id}/reject`, { reason: 'x', expectedVersion: bad })).status, 400, `reject ${JSON.stringify(bad)}`)
  }
  assert.deepEqual([(await row(id)).status, (await row(id)).version], ['PENDING_APPROVAL', 1])
})

// ---- 9: wrong status keeps its existing 400 ----

test('wrong-status calls still answer 400 with the same messages and change nothing', async () => {
  const open = await openQuote()
  const approveOpen = await call('m1', 'POST', `/quotes/${open}/approve`)
  assert.deepEqual([approveOpen.status, approveOpen.body.message ?? approveOpen.body.error], [400, 'Only pending quotes can be approved'])
  const rejectOpen = await call('m1', 'POST', `/quotes/${open}/reject`, { reason: 'x' })
  assert.deepEqual([rejectOpen.status, rejectOpen.body.message ?? rejectOpen.body.error], [400, 'Only pending quotes can be rejected'])
  assert.equal((await row(open)).version, 0)

  const pending = await pendingQuote()
  assert.equal((await call('buyer', 'POST', `/quotes/${pending}/request-approval`)).status, 400)
  assert.equal((await call('m1', 'POST', `/quotes/${pending}/reject`, { reason: '   ' })).status, 400, 'reason still required')
  assert.equal((await call('m1', 'POST', `/quotes/${pending}/approve`)).status, 200)
  assert.equal((await call('m1', 'POST', `/quotes/${pending}/approve`)).status, 400, 'already approved')
  assert.equal((await call('buyer', 'POST', `/quotes/${pending}/request-approval`)).status, 400)
  assert.equal((await row(pending)).version, 2)
})

// ---- 10-11: who may do it ----

test('another tenant cannot submit, approve or reject the quote (404) and nothing changes', async () => {
  const id = await pendingQuote()
  assert.equal((await call('mB', 'POST', `/quotes/${id}/approve`)).status, 404)
  assert.equal((await call('mB', 'POST', `/quotes/${id}/reject`, { reason: 'x' })).status, 404)
  const open = await openQuote()
  assert.equal((await call('mB', 'POST', `/quotes/${open}/request-approval`)).status, 404)
  assert.equal((await call('otherBuyer', 'POST', `/quotes/${open}/request-approval`)).status, 404, 'a buyer of another customer cannot submit it')
  assert.deepEqual([(await row(id)).status, (await row(id)).version, (await row(open)).version], ['PENDING_APPROVAL', 1, 0])
})

test('buyers cannot approve or reject, even their own quote', async () => {
  const id = await pendingQuote()
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/approve`)).status, 403)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/reject`, { reason: 'x' })).status, 403)
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.approvedByUserId], ['PENDING_APPROVAL', 1, null])
})

// ---- 12: contracts ----

test('approve still works with no body; client-sent approval fields are ignored; responses keep their fields', async () => {
  const id = await pendingQuote()
  const res = await call('m1', 'POST', `/quotes/${id}/approve`, {
    approvedByUserId: uid.buyer,
    approvedAt: '2000-01-01T00:00:00.000Z',
    status: 'SUBMITTED',
    version: 99,
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const q = await row(id)
  assert.deepEqual([q.status, q.approvedByUserId, q.version], ['APPROVED', uid.m1, 2])
  assert.ok(q.approvedAt && q.approvedAt.getFullYear() > 2000)
  for (const k of ['id', 'tenantId', 'customerRef', 'status', 'notes', 'convertedOrderId', 'rejectionReason', 'approvedAt', 'approvedByUserId', 'createdAt', 'updatedAt', 'lines', 'version']) {
    assert.ok(k in res.body, `approve response has ${k}`)
  }
  assert.equal((res.body.lines as unknown[]).length, 1)

  const noBody = await pendingQuote()
  assert.equal((await call('m1', 'POST', `/quotes/${noBody}/approve`)).status, 200, 'no body at all, as existing callers send')

  const sub = await openQuote()
  const submitted = await call('buyer', 'POST', `/quotes/${sub}/request-approval`, {})
  for (const k of ['id', 'status', 'lines', 'rejectionReason', 'version', 'createdVia']) assert.ok(k in submitted.body, `request-approval response has ${k}`)
  assert.ok(!('createdByUserId' in submitted.body), 'buyers still are not shown the creator id')

  const rej = await pendingQuote()
  const rejected = await call('m1', 'POST', `/quotes/${rej}/reject`, { reason: 'No' })
  for (const k of ['id', 'status', 'lines', 'rejectionReason', 'version']) assert.ok(k in rejected.body, `reject response has ${k}`)
})
