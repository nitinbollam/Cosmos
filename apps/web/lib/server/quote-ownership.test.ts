/**
 * Ticket #3, phase 1: every new quote records who created it and from where, taken from the session
 * (never the request body). Legacy quotes, without that record, keep working as before.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, storefrontDb, tenantDb } from './db'

const PASSWORD = 'quote-ownership-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
const buyerEmail = `buyer-${randomUUID().slice(0, 6)}@example.test`
const otherBuyerEmail = `other-${randomUUID().slice(0, 6)}@example.test`
const skuCode = `OWN-${randomUUID().slice(0, 5)}`
let customerId = ''
let otherCustomerId = ''
let skuId = ''

type Role = 'STAFF' | 'MANAGER' | 'SALES_REP'

async function makeUser(key: string, tenantId: string, role: Role, email = `${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`) {
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
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> & Array<Record<string, unknown>> }
}

async function makeTenant(id: string) {
  await authDb.tenant.create({ data: { id, name: 'O', slug: `o-${id.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id, slug: `o-${id.slice(-8)}`, displayName: 'O', settings: { salesTaxRate: 0 }, metadata: {} },
  })
}

const line = (over: Record<string, unknown> = {}) => ({ lineNo: 1, skuCode, description: 'Pens', qty: 2, unitPrice: 20, ...over })
const row = (id: string) => storefrontDb.b2BQuote.findUniqueOrThrow({ where: { id } })

before(async () => {
  await makeTenant(tenantA)
  await makeTenant(tenantB)
  await makeUser('rep', tenantA, 'SALES_REP')
  customerId = (await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Buyer Co', email: buyerEmail, salesRepUserId: uid.rep } })).id
  otherCustomerId = (await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Other Co', email: otherBuyerEmail } })).id
  await inventoryDb.warehouse.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN', address: {}, isDefault: true } })
  skuId = (await inventoryDb.sKU.create({
    data: { tenantId: tenantA, code: skuCode, name: 'Office Pens', category: 'Office', cost: new Prisma.Decimal('9'), price: new Prisma.Decimal('24'), imageUrls: [], attributes: {} },
  })).id
  await makeUser('buyer', tenantA, 'STAFF', buyerEmail)
  await makeUser('otherBuyer', tenantA, 'STAFF', otherBuyerEmail)
  await makeUser('manager', tenantA, 'MANAGER')
  await makeUser('managerB', tenantB, 'MANAGER')
})

after(async () => {
  for (const t of [tenantA, tenantB]) {
    await storefrontDb.b2BQuote.deleteMany({ where: { tenantId: t } })
    await inventoryDb.sKU.deleteMany({ where: { tenantId: t } })
    await inventoryDb.warehouse.deleteMany({ where: { tenantId: t } })
    await crmDb.customer.deleteMany({ where: { tenantId: t } })
  }
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
  await authDb.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
})

test('a buyer-created quote records the buyer as creator and the buyer portal as origin', async () => {
  const res = await call('buyer', 'POST', '/quotes', { customerRef: customerId, notes: 'Spring', lines: [line()] })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const q = await row(res.body.id as string)
  assert.equal(q.tenantId, tenantA)
  assert.equal(q.createdByUserId, uid.buyer)
  assert.equal(q.createdVia, 'BUYER_PORTAL')
  assert.equal(q.version, 0)
  assert.equal(q.status, 'OPEN')
  assert.equal(q.withdrawnAt, null)
  assert.equal(q.withdrawReason, null)
})

test('a staff-created quote records the staff user and the staff origin', async () => {
  const res = await call('manager', 'POST', '/quotes', { customerRef: customerId, lines: [line()] })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const q = await row(res.body.id as string)
  assert.equal(q.createdByUserId, uid.manager)
  assert.equal(q.createdVia, 'STAFF')
  assert.equal(q.version, 0)
})

test('a rep quote from the sales-rep app records the rep and the sales-rep origin, still priced by the server', async () => {
  const res = await call('rep', 'POST', `/rep/accounts/${customerId}/quote`, { lines: [{ skuId, quantity: 3, unitPrice: 1 }] })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const q = await storefrontDb.b2BQuote.findUniqueOrThrow({ where: { id: res.body.id as string }, include: { lines: true } })
  assert.equal(q.createdByUserId, uid.rep)
  assert.equal(q.createdVia, 'SALES_REP')
  assert.equal(q.version, 0)
  assert.equal(Number(q.lines[0].unitPrice), 24, 'the rep path still prices from the server, not the body')
})

test('the request body cannot set the creator, origin, status, version or withdrawal fields', async () => {
  const forged = {
    customerRef: customerId,
    lines: [line()],
    createdByUserId: uid.manager,
    createdVia: 'STAFF',
    status: 'APPROVED',
    version: 99,
    withdrawnAt: new Date().toISOString(),
    withdrawReason: 'forged',
    tenantId: tenantB,
    approvedByUserId: uid.manager,
  }
  const asBuyer = await call('buyer', 'POST', '/quotes', forged)
  assert.equal(asBuyer.status, 201, JSON.stringify(asBuyer.body))
  const b = await row(asBuyer.body.id as string)
  assert.deepEqual(
    [b.createdByUserId, b.createdVia, b.status, b.version, b.withdrawnAt, b.withdrawReason, b.tenantId, b.approvedByUserId],
    [uid.buyer, 'BUYER_PORTAL', 'OPEN', 0, null, null, tenantA, null],
  )

  const asStaff = await call('manager', 'POST', '/quotes', { ...forged, createdByUserId: uid.buyer, createdVia: 'BUYER_PORTAL' })
  assert.equal(asStaff.status, 201, JSON.stringify(asStaff.body))
  const s = await row(asStaff.body.id as string)
  assert.deepEqual([s.createdByUserId, s.createdVia, s.status, s.version], [uid.manager, 'STAFF', 'OPEN', 0])
})

test('existing create rules still apply: buyers only quote for their own customer, lines need a real product', async () => {
  assert.equal((await call('buyer', 'POST', '/quotes', { customerRef: otherCustomerId, lines: [line()] })).status, 403)
  assert.equal((await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [line({ skuCode: 'NOPE' })] })).status, 400)
  assert.equal((await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [] })).status, 400)
})

test('the create response keeps every existing field and adds the new ones', async () => {
  const buyer = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [line()] })
  for (const k of ['id', 'tenantId', 'customerRef', 'status', 'notes', 'convertedOrderId', 'rejectionReason', 'approvedAt', 'createdAt', 'updatedAt', 'lines', 'createdVia', 'version', 'withdrawnAt', 'withdrawReason']) {
    assert.ok(k in buyer.body, `create response has ${k}`)
  }
  assert.ok(!('createdByUserId' in buyer.body), 'buyers are not shown the creator user id')
  // Phase 5: nor the approving staff member's id (internal; no buyer screen uses it).
  assert.ok(!('approvedByUserId' in buyer.body), 'buyers are not shown the approver user id')
  const staff = await call('manager', 'POST', '/quotes', { customerRef: customerId, lines: [line()] })
  assert.equal(staff.body.createdByUserId, uid.manager, 'staff see the creator')
  assert.ok('approvedByUserId' in staff.body, 'staff responses keep approvedByUserId')
})

test('a legacy quote (no creator recorded) still lists, opens and moves through approval as before', async () => {
  // Written the way quotes were stored before phase 1: none of the new fields given.
  const legacy = await storefrontDb.b2BQuote.create({
    data: { tenantId: tenantA, customerRef: customerId, status: 'OPEN', lines: { create: [{ lineNo: 1, skuCode, description: 'Old', qty: 1, unitPrice: 5 }] } },
  })
  const stored = await row(legacy.id)
  assert.deepEqual([stored.createdByUserId, stored.createdVia, stored.version, stored.withdrawnAt], [null, null, 0, null])

  const list = await call('buyer', 'GET', '/quotes')
  assert.equal(list.status, 200)
  const listed = list.body.find((q) => q.id === legacy.id)
  assert.ok(listed, 'the buyer still sees their legacy quote')
  assert.equal(listed.customerName, 'Buyer Co')
  assert.equal(listed.quoteNumber, `Q-${legacy.id.slice(-8).toUpperCase()}`)

  const detail = await call('buyer', 'GET', `/quotes/${legacy.id}`)
  assert.equal(detail.status, 200)
  assert.equal(detail.body.createdVia, null)

  assert.equal((await call('buyer', 'POST', `/quotes/${legacy.id}/request-approval`)).status, 200)
  assert.equal((await row(legacy.id)).status, 'PENDING_APPROVAL')
  assert.equal((await call('manager', 'POST', `/quotes/${legacy.id}/reject`, { reason: 'Too low' })).status, 200)
  const after = await row(legacy.id)
  assert.deepEqual([after.status, after.rejectionReason, after.createdByUserId, after.createdVia], ['REJECTED', 'Too low', null, null])
})

test('list and detail: buyers see only their customer’s quotes, without the creator id; staff see all with it', async () => {
  const mine = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [line()] })
  const theirs = await call('otherBuyer', 'POST', '/quotes', { customerRef: otherCustomerId, lines: [line()] })
  assert.equal(theirs.status, 201, JSON.stringify(theirs.body))

  const buyerList = await call('buyer', 'GET', '/quotes')
  assert.ok(buyerList.body.every((q) => q.customerRef === customerId), 'only own customer')
  assert.ok(buyerList.body.some((q) => q.id === mine.body.id))
  assert.ok(buyerList.body.every((q) => !('createdByUserId' in q)))

  assert.equal((await call('buyer', 'GET', `/quotes/${theirs.body.id}`)).status, 404, 'another customer’s quote is hidden')
  const own = await call('buyer', 'GET', `/quotes/${mine.body.id}`)
  assert.equal(own.status, 200)
  assert.equal(own.body.createdVia, 'BUYER_PORTAL')
  assert.equal(own.body.version, 0)
  assert.ok(!('createdByUserId' in own.body))

  const staffDetail = await call('manager', 'GET', `/quotes/${mine.body.id}`)
  assert.equal(staffDetail.body.createdByUserId, uid.buyer)
  const staffList = await call('manager', 'GET', '/quotes?status=OPEN')
  assert.ok(staffList.body.some((q) => q.id === theirs.body.id && q.createdByUserId === uid.otherBuyer))
})

test('tenant isolation: another tenant cannot list or open these quotes', async () => {
  const q = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [line()] })
  assert.equal((await call('managerB', 'GET', `/quotes/${q.body.id}`)).status, 404)
  const listB = await call('managerB', 'GET', '/quotes')
  assert.equal(listB.status, 200)
  assert.equal(listB.body.length, 0)
  // Staff of tenant B cannot create a quote for tenant A's customer either.
  assert.equal((await call('managerB', 'POST', '/quotes', { customerRef: customerId, lines: [line()] })).status, 400)
  assert.equal(await storefrontDb.b2BQuote.count({ where: { tenantId: tenantB } }), 0)
})

test('status behaviour is unchanged: OPEN → PENDING_APPROVAL → APPROVED, and wrong-status calls still answer 400', async () => {
  const q = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [line()] })
  const id = q.body.id as string
  assert.equal((await call('manager', 'POST', `/quotes/${id}/approve`)).status, 400, 'an OPEN quote cannot be approved')
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 400, 'already pending')
  assert.equal((await call('manager', 'POST', `/quotes/${id}/approve`)).status, 200)
  const approved = await row(id)
  assert.equal(approved.status, 'APPROVED')
  assert.equal(approved.approvedByUserId, uid.manager)
  assert.equal(approved.createdByUserId, uid.buyer, 'approval does not change the creator')
  assert.equal(approved.createdVia, 'BUYER_PORTAL')
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 400)
})
