/**
 * Ticket #3, Phase 5: buyers edit (PATCH /quotes/:id) and withdraw (POST /quotes/:id/withdraw) their own quotes.
 * Only the portal buyer who created the quote, only while it is OPEN, PENDING_APPROVAL or REJECTED, only at the
 * version they saw; one guarded storefront transaction per change; nothing is ever deleted.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, orderDb, storefrontDb, tenantDb, wmsDb } from './db'
import { setQuoteRaceHookForTests, type QuoteRacePoint } from './quotes'

const PASSWORD = 'quote-buyer-edit-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
const email = (k: string) => `${k}-${randomUUID().slice(0, 6)}@example.test`
const buyerEmail = email('buyer')
const otherCustEmail = email('othercust')
const viewerEmail = email('viewer')
const buyerBEmail = email('buyerb')
const skuCode = `BE-${randomUUID().slice(0, 5)}`
const sku2Code = `BE2-${randomUUID().slice(0, 5)}`
const retiredCode = `BEX-${randomUUID().slice(0, 5)}`
const skuBCode = `BEB-${randomUUID().slice(0, 5)}`
let customerId = ''
let viewerCustomerId = ''
let customerBId = ''

async function makeUser(key: string, tenantId: string, role: string, e = email(key.toLowerCase())) {
  const user = await authDb.user.create({
    data: { tenantId, email: e, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role: role as never, permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  uid[key] = user.id
  tok[key] = (await loginUser(e, PASSWORD)).accessToken
}

async function call(key: string, method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${tok[key]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> }
}

async function makeTenant(id: string) {
  await authDb.tenant.create({ data: { id, name: 'E', slug: `e-${id.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id, slug: `e-${id.slice(-8)}`, displayName: 'E', settings: { salesTaxRate: 0 }, metadata: {} },
  })
}

const row = (id: string) => storefrontDb.b2BQuote.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
const linesOf = (q: Awaited<ReturnType<typeof row>>) => q.lines.map((l) => [l.lineNo, l.skuCode, l.description, l.qty, l.unitPrice.toString()])
const offerStatus = async (id: unknown) => (await storefrontDb.quoteCounterOffer.findUniqueOrThrow({ where: { id: id as string } })).status
/** Everything stored about a quote, to prove a refused request changed nothing. */
const snapshot = async (id: string) => {
  const q = await row(id)
  return JSON.stringify({ ...q, updatedAt: undefined, lines: q.lines.map((l) => ({ ...l, id: undefined })) })
}

const startLines = [
  { lineNo: 1, skuCode, description: 'Pens', qty: 10, unitPrice: 20 },
  { lineNo: 2, skuCode: sku2Code, description: 'Pads', qty: 5, unitPrice: 8 },
]

/** A quote the buyer raised in the portal, taken to the given status through the real API. */
async function buyerQuote(stage: 'OPEN' | 'PENDING_APPROVAL' | 'REJECTED' | 'APPROVED' | 'SUBMITTED' = 'OPEN', who = 'buyer', ref = customerId) {
  const created = await call(who, 'POST', '/quotes', { customerRef: ref, notes: 'first draft', lines: startLines })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.id as string
  if (stage !== 'OPEN') assert.equal((await call(who, 'POST', `/quotes/${id}/request-approval`)).status, 200)
  if (stage === 'REJECTED') assert.equal((await call('m1', 'POST', `/quotes/${id}/reject`, { reason: 'too low' })).status, 200)
  if (stage === 'APPROVED' || stage === 'SUBMITTED') assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  if (stage === 'SUBMITTED') assert.equal((await call(who, 'POST', `/quotes/${id}/submit`)).status, 200)
  return id
}

const v = async (id: string) => (await row(id)).version
const edit = async (id: string, body: Record<string, unknown>, who = 'buyer') => call(who, 'PATCH', `/quotes/${id}`, body)
const withdraw = async (id: string, body: Record<string, unknown>, who = 'buyer') => call(who, 'POST', `/quotes/${id}/withdraw`, body)
const newLines = [{ lineNo: 1, skuCode: sku2Code, qty: 7, unitPrice: 9.25 }]

function onceAt(point: QuoteRacePoint, fn: () => Promise<void>) {
  let fired = false
  setQuoteRaceHookForTests(async (p) => {
    if (p !== point || fired) return
    fired = true
    await fn()
  })
  return () => fired
}

before(async () => {
  await makeTenant(tenantA)
  await makeTenant(tenantB)
  customerId = (await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Buyer Co', email: buyerEmail } })).id
  await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Other Co', email: otherCustEmail } })
  viewerCustomerId = (await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Viewer Co', email: viewerEmail } })).id
  customerBId = (await crmDb.customer.create({ data: { tenantId: tenantB, name: 'B Co', email: buyerBEmail } })).id
  const wh = await inventoryDb.warehouse.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN', address: {}, isDefault: true } })
  for (const [tenantId, code, name, isActive] of [
    [tenantA, skuCode, 'Pens', true],
    [tenantA, sku2Code, 'Pads', true],
    [tenantA, retiredCode, 'Old', false],
    [tenantB, skuBCode, 'B thing', true],
  ] as const) {
    const sku = await inventoryDb.sKU.create({
      data: { tenantId, code, name, category: 'Office', cost: new Prisma.Decimal('5'), price: new Prisma.Decimal('24'), imageUrls: [], attributes: {}, isActive },
    })
    if (tenantId === tenantA) {
      await inventoryDb.stockLevel.create({ data: { tenantId, skuId: sku.id, warehouseId: wh.id, batchId: '', quantityOnHand: 100000, quantityAvailable: 100000 } })
    }
  }
  await makeUser('buyer', tenantA, 'STAFF', buyerEmail) // portal buyer of Buyer Co
  await makeUser('otherCust', tenantA, 'STAFF', otherCustEmail) // portal buyer of Other Co
  await makeUser('viewer', tenantA, 'VIEWER', viewerEmail) // portal role without portal.quotes
  await makeUser('m1', tenantA, 'MANAGER')
  await makeUser('rep', tenantA, 'SALES_REP')
  await makeUser('admin', tenantA, 'TENANT_ADMIN')
  await makeUser('buyerB', tenantB, 'STAFF', buyerBEmail) // a portal buyer of another tenant
})

afterEach(() => setQuoteRaceHookForTests(null))

after(async () => {
  setQuoteRaceHookForTests(null)
  await new Promise((r) => setTimeout(r, 500))
  for (const t of [tenantA, tenantB]) {
    const ids = (await storefrontDb.b2BQuote.findMany({ where: { tenantId: t }, select: { id: true } })).map((q) => q.id)
    await storefrontDb.quoteCounterOffer.deleteMany({ where: { quoteId: { in: ids } } })
    await storefrontDb.b2BQuote.deleteMany({ where: { tenantId: t } })
    await wmsDb.fulfillmentTask.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await orderDb.order.deleteMany({ where: { tenantId: t } })
    await orderDb.orderCounter.deleteMany({ where: { tenantId: t } })
    await inventoryDb.stockReservation.deleteMany({ where: { tenantId: t } })
    await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId: t } }).catch(() => undefined)
    await inventoryDb.stockLevel.deleteMany({ where: { tenantId: t } })
    await inventoryDb.sKU.deleteMany({ where: { tenantId: t } })
    await inventoryDb.warehouse.deleteMany({ where: { tenantId: t } })
    await crmDb.creditApplication.deleteMany({ where: { tenantId: t } })
    await crmDb.customer.deleteMany({ where: { tenantId: t } })
  }
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
  await authDb.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
})

// ---- 1-5: editing ----

test('1. the owner edits an OPEN quote: lines and notes replaced, version + 1, still OPEN', async () => {
  const id = await buyerQuote()
  const before = await row(id)
  const res = await edit(id, { expectedVersion: before.version, notes: '  revised  ', lines: newLines })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const q = await row(id)
  assert.deepEqual([q.status, q.version, q.notes], ['OPEN', before.version + 1, 'revised'])
  assert.deepEqual(linesOf(q), [[1, sku2Code, 'Pads', 7, '9.25']], 'description defaults to the product name')
  assert.deepEqual([res.body.status, res.body.version], ['OPEN', before.version + 1])
  // Only notes: lines untouched.
  assert.equal((await edit(id, { expectedVersion: q.version, notes: null })).status, 200)
  const q2 = await row(id)
  assert.deepEqual([q2.notes, linesOf(q2), q2.version], [null, linesOf(q), q.version + 1])
})

test('2 + 4. the owner edits a PENDING_APPROVAL quote: back to OPEN, and approval must be requested again', async () => {
  const id = await buyerQuote('PENDING_APPROVAL')
  const res = await edit(id, { expectedVersion: await v(id), lines: newLines })
  assert.equal(res.status, 200)
  assert.equal((await row(id)).status, 'OPEN')
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 400, 'not pending any more: nothing to approve')
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  assert.deepEqual(linesOf(await row(id)), [[1, sku2Code, 'Pads', 7, '9.25']], 'the edited terms are what got approved')
})

test('3 + 5. the owner edits a REJECTED quote: back to OPEN; the rejection reason stays on record', async () => {
  const id = await buyerQuote('REJECTED')
  const res = await edit(id, { expectedVersion: await v(id), lines: newLines })
  assert.equal(res.status, 200)
  const q = await row(id)
  assert.deepEqual([q.status, q.rejectionReason], ['OPEN', 'too low'])
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  assert.equal((await row(id)).rejectionReason, null, 'cleared by the new approval request, as before')
})

// ---- 6-11: withdrawing ----

test('6-8. the owner withdraws an OPEN, PENDING_APPROVAL or REJECTED quote', async () => {
  for (const stage of ['OPEN', 'PENDING_APPROVAL', 'REJECTED'] as const) {
    const id = await buyerQuote(stage)
    const before = await row(id)
    const res = await withdraw(id, { expectedVersion: before.version, withdrawReason: `no longer needed (${stage})` })
    assert.equal(res.status, 200, `${stage}: ${JSON.stringify(res.body)}`)
    const q = await row(id)
    assert.deepEqual([q.status, q.version, q.withdrawReason], ['WITHDRAWN', before.version + 1, `no longer needed (${stage})`])
    assert.equal(res.body.status, 'WITHDRAWN')
  }
})

test('9. the withdrawal time is the server’s; a client-sent time is refused', async () => {
  const id = await buyerQuote()
  assert.equal((await withdraw(id, { expectedVersion: await v(id), withdrawnAt: '2000-01-01T00:00:00.000Z' })).status, 400)
  assert.equal((await row(id)).withdrawnAt, null)
  const t0 = Date.now()
  assert.equal((await withdraw(id, { expectedVersion: await v(id) })).status, 200)
  const at = (await row(id)).withdrawnAt!.getTime()
  assert.ok(at >= t0 - 1000 && at <= Date.now() + 1000, 'server time')
})

test('10. the withdrawal reason is optional (absent, null or blank is stored as none)', async () => {
  for (const reason of [undefined, null, '   ']) {
    const id = await buyerQuote()
    const body: Record<string, unknown> = { expectedVersion: await v(id) }
    if (reason !== undefined) body.withdrawReason = reason
    assert.equal((await withdraw(id, body)).status, 200)
    const q = await row(id)
    assert.deepEqual([q.status, q.withdrawReason], ['WITHDRAWN', null])
  }
  const id = await buyerQuote()
  assert.equal((await withdraw(id, { expectedVersion: await v(id), withdrawReason: 'x'.repeat(501) })).status, 400)
  assert.equal((await withdraw(id, { expectedVersion: await v(id), withdrawReason: 42 })).status, 400)
})

test('11. a withdrawn quote keeps its lines, notes and negotiation history; open offers become SUPERSEDED', async () => {
  const id = await buyerQuote()
  const accepted = await call('m1', 'POST', `/quotes/${id}/counter-offers`, { lines: [{ lineNo: 1, qty: 9, unitPrice: 19 }, { lineNo: 2, qty: 5, unitPrice: 8 }] })
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/counter-offers/accept`, { counterOfferId: accepted.body.id })).status, 200)
  const open = await call('m1', 'POST', `/quotes/${id}/counter-offers`, { lines: [{ lineNo: 1, qty: 8, unitPrice: 18 }] })
  const before = await row(id)
  assert.equal((await withdraw(id, { expectedVersion: before.version, withdrawReason: 'went elsewhere' })).status, 200)
  const q = await row(id)
  assert.deepEqual([linesOf(q), q.notes, q.createdByUserId, q.createdVia], [linesOf(before), before.notes, uid.buyer, 'BUYER_PORTAL'])
  assert.equal(await storefrontDb.b2BQuote.count({ where: { id } }), 1, 'never deleted')
  assert.deepEqual([await offerStatus(accepted.body.id), await offerStatus(open.body.id)], ['ACCEPTED', 'SUPERSEDED'])
  assert.equal(await storefrontDb.quoteCounterOffer.count({ where: { quoteId: id } }), 2)
  assert.equal((await call('buyer', 'GET', `/quotes/${id}`)).body.status, 'WITHDRAWN', 'still listed and readable')
})

// ---- 12-18: who may change a quote ----

async function refusedEverywhere(id: string, who: string, code: number) {
  const before = await snapshot(id)
  const e = await edit(id, { expectedVersion: await v(id), lines: newLines }, who)
  const w = await withdraw(id, { expectedVersion: await v(id) }, who)
  assert.deepEqual([e.status, w.status], [code, code], `${who}: ${JSON.stringify(e.body)} ${JSON.stringify(w.body)}`)
  assert.equal(await snapshot(id), before, 'nothing changed')
  return e
}

test('12. a quote raised by staff for the customer can’t be edited or withdrawn by the buyer (403)', async () => {
  const created = await call('m1', 'POST', '/quotes', { customerRef: customerId, lines: startLines })
  const id = created.body.id as string
  assert.equal((await row(id)).createdVia, 'STAFF')
  assert.equal((await call('buyer', 'GET', `/quotes/${id}`)).status, 200, 'visible to the buyer')
  const res = await refusedEverywhere(id, 'buyer', 403)
  assert.match(String(res.body.message), /created this quote in the portal/)
})

test('13. a sales-rep quote can’t be changed by the buyer; sales reps and staff can’t use these endpoints at all', async () => {
  const id = await buyerQuote()
  await storefrontDb.b2BQuote.update({ where: { id }, data: { createdVia: 'SALES_REP', createdByUserId: uid.rep } })
  await refusedEverywhere(id, 'buyer', 403)
  // The endpoints are the buyer's own: staff, reps and admins are refused even on a buyer's quote.
  const own = await buyerQuote()
  for (const who of ['rep', 'm1', 'admin']) {
    const res = await refusedEverywhere(own, who, 403)
    assert.match(String(res.body.message), /Only buyer portal users/)
  }
})

test('14. a legacy quote (no recorded creator) can’t be changed', async () => {
  const id = await buyerQuote()
  await storefrontDb.b2BQuote.update({ where: { id }, data: { createdVia: null, createdByUserId: null } })
  await refusedEverywhere(id, 'buyer', 403)
  // Half-recorded legacy rows are refused too.
  await storefrontDb.b2BQuote.update({ where: { id }, data: { createdVia: 'BUYER_PORTAL', createdByUserId: null } })
  await refusedEverywhere(id, 'buyer', 403)
})

test('15. a quote another buyer login of the same customer created can’t be changed (403)', async () => {
  const id = await buyerQuote()
  await storefrontDb.b2BQuote.update({ where: { id }, data: { createdByUserId: uid.otherCust } }) // a different portal user
  await refusedEverywhere(id, 'buyer', 403)
})

test('16. another customer’s buyer gets 404, as for every other quote action', async () => {
  const id = await buyerQuote()
  const res = await refusedEverywhere(id, 'otherCust', 404)
  assert.match(String(res.body.message), /not found/i)
})

test('17. a buyer of another tenant gets 404', async () => {
  const id = await buyerQuote()
  await refusedEverywhere(id, 'buyerB', 404)
})

test('18. a portal user without portal.quotes can’t edit or withdraw even their own quote', async () => {
  const id = await buyerQuote('OPEN', 'viewer', viewerCustomerId)
  const q = await row(id)
  assert.deepEqual([q.createdVia, q.createdByUserId], ['BUYER_PORTAL', uid.viewer], 'their own quote')
  const res = await refusedEverywhere(id, 'viewer', 403)
  assert.match(String(res.body.message), /portal\.quotes/)
})

// ---- 19-23: frozen quotes, stale versions ----

test('19-21. APPROVED, SUBMITTED and EXPIRED quotes can’t be edited or withdrawn (400, nothing changes)', async () => {
  const approved = await buyerQuote('APPROVED')
  const submitted = await buyerQuote('SUBMITTED')
  const expired = await buyerQuote()
  await storefrontDb.b2BQuote.update({ where: { id: expired }, data: { status: 'EXPIRED', version: { increment: 1 } } })
  for (const [id, status] of [[approved, 'approved'], [submitted, 'submitted'], [expired, 'expired']] as const) {
    const res = await refusedEverywhere(id, 'buyer', 400)
    assert.match(String(res.body.message), new RegExp(status))
  }
  assert.ok((await row(submitted)).convertedOrderId, 'the converted quote still points at its order')
})

test('22. a withdrawn quote is final: no edit, second withdrawal, approval request, approval, order or counter-offer', async () => {
  const id = await buyerQuote('PENDING_APPROVAL')
  assert.equal((await withdraw(id, { expectedVersion: await v(id) })).status, 200)
  const before = await snapshot(id)
  const e = await edit(id, { expectedVersion: await v(id), lines: newLines })
  const w = await withdraw(id, { expectedVersion: await v(id) })
  assert.deepEqual([e.status, w.status], [400, 400])
  assert.match(String(w.body.message), /withdrawn again/)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 400)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 400)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/reject`, { reason: 'x' })).status, 400)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 400)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/counter-offers`, { lines: [{ lineNo: 1, qty: 1, unitPrice: 1 }] })).status, 400)
  assert.equal(await snapshot(id), before)
  assert.equal(await orderDb.order.count({ where: { tenantId: tenantA, sourceQuoteId: id } }), 0)
})

test('23. a stale or missing expectedVersion never overwrites a newer quote', async () => {
  const id = await buyerQuote()
  const v0 = await v(id)
  assert.equal((await edit(id, { expectedVersion: v0, notes: 'v1' })).status, 200)
  const before = await snapshot(id)
  const stale = await edit(id, { expectedVersion: v0, lines: newLines })
  assert.equal(stale.status, 409)
  assert.equal((await withdraw(id, { expectedVersion: v0 })).status, 409)
  for (const bad of [undefined, null, -1, 1.5, '1']) {
    const body: Record<string, unknown> = { notes: 'x' }
    if (bad !== undefined) body.expectedVersion = bad
    assert.equal((await edit(id, body)).status, 400, `expectedVersion ${JSON.stringify(bad)}`)
    assert.equal((await withdraw(id, bad === undefined ? {} : { expectedVersion: bad })).status, 400)
  }
  assert.equal(await snapshot(id), before)
})

// ---- 24-27: races ----

test('24. two edits at the same version: exactly one lands (deterministic and simultaneous)', async () => {
  const id = await buyerQuote()
  const v0 = await v(id)
  let inner = 0
  onceAt('edit:after-read', async () => {
    inner = (await edit(id, { expectedVersion: v0, lines: [{ lineNo: 1, skuCode, qty: 1, unitPrice: 1 }] })).status
  })
  const outer = await edit(id, { expectedVersion: v0, lines: [{ lineNo: 1, skuCode, qty: 2, unitPrice: 2 }] })
  assert.deepEqual([inner, outer.status], [200, 409])
  const q = await row(id)
  assert.deepEqual([q.version, linesOf(q)], [v0 + 1, [[1, skuCode, 'Pens', 1, '1']]], 'the first edit stands, untouched')

  const id2 = await buyerQuote()
  const v2 = await v(id2)
  const both = await Promise.all([
    edit(id2, { expectedVersion: v2, lines: [{ lineNo: 1, skuCode, qty: 3, unitPrice: 3 }] }),
    edit(id2, { expectedVersion: v2, lines: [{ lineNo: 1, skuCode, qty: 4, unitPrice: 4 }] }),
  ])
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 409])
  const q2 = await row(id2)
  assert.equal(q2.version, v2 + 1)
  assert.equal(q2.lines.length, 1)
})

test('24b. the other races: edit vs reject, edit vs request-approval, edit vs withdraw, two withdrawals', async () => {
  // edit vs reject: the rejection lands first; the edit is refused.
  const a = await buyerQuote('PENDING_APPROVAL')
  onceAt('edit:after-read', async () => {
    assert.equal((await call('m1', 'POST', `/quotes/${a}/reject`, { reason: 'no' })).status, 200)
  })
  assert.equal((await edit(a, { expectedVersion: await v(a), lines: newLines })).status, 409)
  assert.deepEqual([(await row(a)).status, linesOf(await row(a))[0][3]], ['REJECTED', 10])

  // reject vs edit: the edit lands first; the rejection is refused.
  const b = await buyerQuote('PENDING_APPROVAL')
  const vb = await v(b)
  onceAt('reject:after-read', async () => {
    assert.equal((await edit(b, { expectedVersion: vb, lines: newLines })).status, 200)
  })
  assert.equal((await call('m1', 'POST', `/quotes/${b}/reject`, { reason: 'no' })).status, 409)
  assert.deepEqual([(await row(b)).status, (await row(b)).rejectionReason], ['OPEN', null])

  // edit vs request-approval: the request lands first; the edit is refused, the quote waits for approval as sent.
  const c = await buyerQuote()
  const vc = await v(c)
  onceAt('edit:after-read', async () => {
    assert.equal((await call('buyer', 'POST', `/quotes/${c}/request-approval`)).status, 200)
  })
  assert.equal((await edit(c, { expectedVersion: vc, lines: newLines })).status, 409)
  assert.deepEqual([(await row(c)).status, (await row(c)).version], ['PENDING_APPROVAL', vc + 1])

  // edit vs withdraw: the withdrawal lands first; the edit is refused with a clear reason.
  const d = await buyerQuote()
  const vd = await v(d)
  onceAt('edit:after-read', async () => {
    assert.equal((await withdraw(d, { expectedVersion: vd })).status, 200)
  })
  const late = await edit(d, { expectedVersion: vd, lines: newLines })
  assert.equal(late.status, 409)
  assert.match(String(late.body.message), /withdrawn/)
  assert.deepEqual([(await row(d)).status, (await row(d)).version, linesOf(await row(d))[0][3]], ['WITHDRAWN', vd + 1, 10])

  // two withdrawals at once: one lands, one version step.
  const e = await buyerQuote()
  const ve = await v(e)
  const both = await Promise.all([withdraw(e, { expectedVersion: ve, withdrawReason: 'a' }), withdraw(e, { expectedVersion: ve, withdrawReason: 'b' })])
  assert.equal(both.filter((r) => r.status === 200).length, 1, JSON.stringify(both.map((r) => r.status)))
  assert.ok(both.every((r) => [200, 400, 409].includes(r.status)))
  assert.equal((await row(e)).version, ve + 1)
})

test('25. edit vs approval: whichever lands first wins; the other gets 409 and changes nothing', async () => {
  // Approved between the edit's read and write: the approved terms stand.
  const a = await buyerQuote('PENDING_APPROVAL')
  const pending = await row(a)
  onceAt('edit:after-read', async () => {
    assert.equal((await call('m1', 'POST', `/quotes/${a}/approve`)).status, 200)
  })
  const res = await edit(a, { expectedVersion: pending.version, lines: newLines })
  assert.equal(res.status, 409)
  assert.match(String(res.body.message), /approved/)
  const qa = await row(a)
  assert.deepEqual([qa.status, qa.version, linesOf(qa)], ['APPROVED', pending.version + 1, linesOf(pending)])

  // Edited between the approval's read and write: the approval is refused; nothing unseen gets approved.
  const b = await buyerQuote('PENDING_APPROVAL')
  const vb = await v(b)
  onceAt('approve:after-read', async () => {
    assert.equal((await edit(b, { expectedVersion: vb, lines: newLines })).status, 200)
  })
  assert.equal((await call('m1', 'POST', `/quotes/${b}/approve`)).status, 409)
  const qb = await row(b)
  assert.deepEqual([qb.status, qb.approvedAt, qb.version], ['OPEN', null, vb + 1])
})

test('26. withdrawal vs approval and vs conversion', async () => {
  // Approved and converted between the withdrawal's read and write: the order stands, the withdrawal is refused.
  const a = await buyerQuote('PENDING_APPROVAL')
  const va = await v(a)
  onceAt('withdraw:after-read', async () => {
    assert.equal((await call('m1', 'POST', `/quotes/${a}/approve`)).status, 200)
    assert.equal((await call('buyer', 'POST', `/quotes/${a}/submit`)).status, 200)
  })
  const res = await withdraw(a, { expectedVersion: va })
  assert.equal(res.status, 409)
  const qa = await row(a)
  assert.equal(qa.status, 'SUBMITTED')
  assert.equal(qa.withdrawnAt, null)
  assert.equal(await orderDb.order.count({ where: { tenantId: tenantA, sourceQuoteId: a } }), 1)

  // Withdrawn between the approval's read and write: the approval is refused; no order can follow.
  const b = await buyerQuote('PENDING_APPROVAL')
  const vb = await v(b)
  onceAt('approve:after-read', async () => {
    assert.equal((await withdraw(b, { expectedVersion: vb })).status, 200)
  })
  assert.equal((await call('m1', 'POST', `/quotes/${b}/approve`)).status, 409)
  assert.deepEqual([(await row(b)).status, (await row(b)).approvedAt], ['WITHDRAWN', null])
  assert.equal((await call('buyer', 'POST', `/quotes/${b}/submit`)).status, 400)
  assert.equal(await orderDb.order.count({ where: { tenantId: tenantA, sourceQuoteId: b } }), 0)
})

test('27. edit vs counter-offer acceptance, both orders; an edit supersedes offers made against the old lines', async () => {
  // Accepted between the edit's read and write: the edit is refused, the accepted terms stand.
  const a = await buyerQuote()
  const offerA = await call('m1', 'POST', `/quotes/${a}/counter-offers`, { lines: [{ lineNo: 1, qty: 11, unitPrice: 11 }, { lineNo: 2, qty: 5, unitPrice: 8 }] })
  const va = await v(a)
  onceAt('edit:after-read', async () => {
    assert.equal((await call('buyer', 'POST', `/quotes/${a}/counter-offers/accept`, { counterOfferId: offerA.body.id })).status, 200)
  })
  assert.equal((await edit(a, { expectedVersion: va, lines: newLines })).status, 409)
  assert.deepEqual(linesOf(await row(a)).map((l) => [l[3], l[4]]), [[11, '11'], [5, '8']])

  // Edited between the acceptance's read and write: the acceptance is refused, the edit stands, the offer is stale.
  const b = await buyerQuote()
  const offerB = await call('m1', 'POST', `/quotes/${b}/counter-offers`, { lines: [{ lineNo: 1, qty: 12, unitPrice: 12 }] })
  const vb = await v(b)
  onceAt('accept:after-read', async () => {
    assert.equal((await edit(b, { expectedVersion: vb, lines: newLines })).status, 200)
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${b}/counter-offers/accept`, { counterOfferId: offerB.body.id })).status, 409)
  assert.deepEqual(linesOf(await row(b)), [[1, sku2Code, 'Pads', 7, '9.25']])
  assert.equal(await offerStatus(offerB.body.id), 'SUPERSEDED')
  assert.equal((await call('buyer', 'POST', `/quotes/${b}/counter-offers/accept`, { counterOfferId: offerB.body.id })).status, 400, 'and stays unacceptable')
})

// ---- 28-32: validation ----

async function refusedEdit(id: string, body: Record<string, unknown>, pattern: RegExp, label: string) {
  const before = await snapshot(id)
  const res = await edit(id, { expectedVersion: await v(id), ...body })
  assert.equal(res.status, 400, `${label}: ${JSON.stringify(res.body)}`)
  assert.match(String(res.body.message), pattern, label)
  assert.equal(await snapshot(id), before, `${label}: nothing changed`)
}

test('28. quantities must be whole numbers from 1 to the order-line maximum', async () => {
  const id = await buyerQuote()
  for (const qty of [0, -2, 1.5, '3', null, true, 1_000_001]) {
    await refusedEdit(id, { lines: [{ lineNo: 1, skuCode, qty, unitPrice: 1 }] }, /quantity/, `qty ${JSON.stringify(qty)}`)
  }
  await refusedEdit(id, { lines: [{ lineNo: 1, skuCode, unitPrice: 1 }] }, /quantity/, 'qty missing')
  assert.equal((await edit(id, { expectedVersion: await v(id), lines: [{ lineNo: 1, skuCode, qty: 1_000_000, unitPrice: 1 }] })).status, 200)
})

test('29. every line must name an active product of this tenant', async () => {
  const id = await buyerQuote()
  await refusedEdit(id, { lines: [{ lineNo: 1, skuCode: 'NO-SUCH-SKU', qty: 1, unitPrice: 1 }] }, /no product/, 'unknown SKU')
  await refusedEdit(id, { lines: [{ lineNo: 1, skuCode: retiredCode, qty: 1, unitPrice: 1 }] }, /inactive/, 'inactive SKU')
  await refusedEdit(id, { lines: [{ lineNo: 1, skuCode: skuBCode, qty: 1, unitPrice: 1 }] }, /no product/, 'another tenant’s SKU')
  await refusedEdit(id, { lines: [{ lineNo: 1, qty: 1, unitPrice: 1 }] }, /choose a product/, 'no SKU')
  await refusedEdit(id, { lines: [{ lineNo: 1, skuCode: 7, qty: 1, unitPrice: 1 }] }, /skuCode/, 'SKU not text')
})

test('30. unit prices must be plain amounts of 0 or more with at most 4 decimals (0 allowed, as at creation)', async () => {
  const id = await buyerQuote()
  for (const unitPrice of [-1, -0.01, null, 'abc', '1e3', '', 1.12345, 1_000_000_001, {}, false]) {
    await refusedEdit(id, { lines: [{ lineNo: 1, skuCode, qty: 1, unitPrice }] }, /unit price/, `price ${JSON.stringify(unitPrice)}`)
  }
  const ok = await edit(id, { expectedVersion: await v(id), lines: [{ lineNo: 1, skuCode, qty: 1, unitPrice: 0 }, { lineNo: 2, skuCode, qty: 1, unitPrice: '12.3456' }] })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.deepEqual(linesOf(await row(id)).map((l) => l[4]), ['0', '12.3456'])
})

test('31. lines must be present, unique, well-formed and within limits; notes are bounded text', async () => {
  const id = await buyerQuote()
  await refusedEdit(id, { lines: [{ lineNo: 1, skuCode, qty: 1, unitPrice: 1 }, { lineNo: 1, skuCode: sku2Code, qty: 2, unitPrice: 2 }] }, /Duplicate line/, 'duplicate')
  await refusedEdit(id, { lines: [] }, /at least one line/, 'empty')
  await refusedEdit(id, { lines: 'all of them' }, /at least one line/, 'not a list')
  await refusedEdit(id, { lines: [null] }, /must be an object/, 'line null')
  await refusedEdit(id, { lines: [{ lineNo: 0, skuCode, qty: 1, unitPrice: 1 }] }, /lineNo/, 'lineNo 0')
  await refusedEdit(id, { lines: [{ lineNo: 2.5, skuCode, qty: 1, unitPrice: 1 }] }, /lineNo/, 'fractional lineNo')
  await refusedEdit(id, { lines: Array.from({ length: 201 }, (_, i) => ({ lineNo: i + 1, skuCode, qty: 1, unitPrice: 1 })) }, /at most 200/, 'too many')
  await refusedEdit(id, { notes: 'x'.repeat(2001) }, /notes/, 'notes too long')
  await refusedEdit(id, { notes: 99 }, /notes/, 'notes not text')
  await refusedEdit(id, {}, /Nothing to change/, 'nothing sent')
  const bad = await call('buyer', 'PATCH', `/quotes/${id}`, '{not json')
  assert.equal(bad.status, 400)
  // A deactivated customer can't change quotes, as it can't create them.
  await crmDb.customer.update({ where: { id: customerId }, data: { isActive: false } })
  try {
    const res = await edit(id, { expectedVersion: await v(id), notes: 'x' })
    assert.ok(res.status >= 400 && res.status < 500, `deactivated customer: ${res.status}`)
  } finally {
    await crmDb.customer.update({ where: { id: customerId }, data: { isActive: true } })
  }
})

test('32. protected fields can’t be set: any of them makes the request fail, and nothing changes', async () => {
  const id = await buyerQuote('PENDING_APPROVAL')
  for (const [field, value] of [
    ['tenantId', tenantB], ['customerRef', 'someone-else'], ['createdByUserId', uid.m1], ['createdVia', 'STAFF'],
    ['approvedByUserId', uid.m1], ['approvedAt', '2020-01-01'], ['convertedOrderId', 'o-1'], ['withdrawnAt', '2020-01-01'],
    ['withdrawReason', 'x'], ['version', 99], ['status', 'APPROVED'], ['rejectionReason', ''], ['updatedAt', '2020-01-01'], ['id', 'q-1'], ['surprise', 1],
  ] as const) {
    await refusedEdit(id, { notes: 'ok', [field]: value }, new RegExp(field), field)
  }
  for (const field of ['status', 'version', 'customerRef', 'notes', 'lines']) {
    const before = await snapshot(id)
    const res = await withdraw(id, { expectedVersion: await v(id), [field]: 'x' })
    assert.equal(res.status, 400, `withdraw with ${field}`)
    assert.equal(await snapshot(id), before)
  }
  // Extra keys inside a line can't redirect it: a line is rebuilt from its own fields onto this quote only.
  const other = await buyerQuote()
  const otherBefore = await snapshot(other)
  const res = await edit(id, { expectedVersion: await v(id), lines: [{ lineNo: 1, skuCode, qty: 3, unitPrice: 3, quoteId: other, id: 'x', description: 'Mine' }] })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual(linesOf(await row(id)), [[1, skuCode, 'Mine', 3, '3']])
  assert.equal(await snapshot(other), otherBefore, 'the other quote is untouched')
  const q = await row(id)
  assert.deepEqual([q.customerRef, q.createdByUserId, q.createdVia, q.tenantId], [customerId, uid.buyer, 'BUYER_PORTAL', tenantA])
})

// ---- 33-35: compatibility, isolation, redaction ----

test('33. existing quote APIs are unchanged', async () => {
  // Create, read, list, request approval, counter-offers, approve, submit: same paths and answers as before.
  const id = await buyerQuote()
  const staffView = await call('m1', 'GET', `/quotes/${id}`)
  assert.equal(staffView.status, 200)
  for (const k of ['id', 'tenantId', 'customerRef', 'status', 'notes', 'convertedOrderId', 'rejectionReason', 'approvedAt', 'approvedByUserId', 'createdAt', 'updatedAt', 'lines', 'version', 'customerName', 'quoteNumber', 'createdByUserId', 'createdVia', 'withdrawnAt', 'withdrawReason']) {
    assert.ok(k in staffView.body, `staff detail has ${k}`)
  }
  assert.equal((await call('buyer', 'GET', '/quotes')).status, 200)
  assert.equal((await call('m1', 'GET', '/quotes?status=OPEN')).status, 200)
  const o = await call('m1', 'POST', `/quotes/${id}/counter-offers`, { offeredBy: 'ADMIN', lines: [{ lineNo: 1, qty: 9, unitPrice: 19 }, { lineNo: 2, qty: 5, unitPrice: 8 }] })
  assert.equal(o.status, 201)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/counter-offers/accept`, { counterOfferId: o.body.id })).status, 200)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  const approved = await call('m1', 'POST', `/quotes/${id}/approve`)
  assert.equal(approved.status, 200)
  assert.equal(approved.body.approvedByUserId, uid.m1, 'staff still see the approver')
  const placed = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(placed.status, 200)
  assert.ok(placed.body.convertedOrderId)
  // Methods that never existed still answer 404.
  assert.equal((await call('buyer', 'PUT', `/quotes/${id}`, {})).status, 404)
  assert.equal((await call('buyer', 'DELETE', `/quotes/${id}`)).status, 404)
})

test('34. tenant isolation: another tenant’s quotes and lists are never touched or shown', async () => {
  const createdB = await call('buyerB', 'POST', '/quotes', { customerRef: customerBId, lines: [{ lineNo: 1, skuCode: skuBCode, description: 'B', qty: 1, unitPrice: 1 }] })
  assert.equal(createdB.status, 201, JSON.stringify(createdB.body))
  const quoteB = createdB.body.id as string
  const beforeB = await snapshot(quoteB)
  // Tenant A's buyer can't see or change it; tenant B's buyer edits their own fine, scoped to tenant B.
  await refusedEverywhere(quoteB, 'buyer', 404)
  const a = await buyerQuote()
  const beforeA = await snapshot(a)
  assert.equal((await edit(quoteB, { expectedVersion: await v(quoteB), notes: 'B edit' }, 'buyerB')).status, 200)
  assert.equal(await snapshot(a), beforeA, 'tenant A untouched')
  assert.notEqual(await snapshot(quoteB), beforeB)
  const listA = (await call('buyer', 'GET', '/quotes')).body as unknown as Array<{ id: string; tenantId: string }>
  assert.ok(listA.every((q) => q.tenantId === tenantA) && !listA.some((q) => q.id === quoteB))
})

test('35. buyer responses carry no internal user ids; staff responses keep them', async () => {
  const id = await buyerQuote('APPROVED')
  const q = await row(id)
  assert.equal(q.approvedByUserId, uid.m1)
  const responses = [
    await call('buyer', 'GET', `/quotes/${id}`),
    { status: 200, body: ((await call('buyer', 'GET', '/quotes')).body as unknown as Array<Record<string, unknown>>).find((r) => r.id === id)! },
    await call('buyer', 'POST', `/quotes/${id}/submit`),
  ]
  for (const r of responses) {
    assert.equal(r.status, 200)
    assert.ok(!('approvedByUserId' in r.body) && !('createdByUserId' in r.body), JSON.stringify(Object.keys(r.body)))
    assert.ok(!JSON.stringify(r.body).includes(uid.m1), 'the approver id appears nowhere')
    for (const k of ['id', 'status', 'lines', 'version', 'approvedAt', 'convertedOrderId', 'quoteNumber']) assert.ok(k in r.body, `buyer still gets ${k}`)
  }
  const edited = await buyerQuote()
  const res = await edit(edited, { expectedVersion: await v(edited), notes: 'n' })
  assert.ok(!('createdByUserId' in res.body) && !('approvedByUserId' in res.body), 'edit response redacted')
  const w = await withdraw(edited, { expectedVersion: await v(edited) })
  assert.ok(!('createdByUserId' in w.body) && !('approvedByUserId' in w.body), 'withdraw response redacted')
  const staff = await call('m1', 'GET', `/quotes/${id}`)
  assert.deepEqual([staff.body.approvedByUserId, staff.body.createdByUserId], [uid.m1, uid.buyer])
})

// ---- Phase 6: canEdit / canWithdraw for the portal, and the bodies the portal sends ----

const flagsOf = async (who: string, id: string) => {
  const r = await call(who, 'GET', `/quotes/${id}`)
  return [r.body.canEdit, r.body.canWithdraw]
}

test('F1. buyers get canEdit / canWithdraw: true only on their own portal quotes in an editable status', async () => {
  for (const stage of ['OPEN', 'PENDING_APPROVAL', 'REJECTED'] as const) {
    assert.deepEqual(await flagsOf('buyer', await buyerQuote(stage)), [true, true], stage)
  }
  for (const stage of ['APPROVED', 'SUBMITTED'] as const) {
    assert.deepEqual(await flagsOf('buyer', await buyerQuote(stage)), [false, false], stage)
  }
  const withdrawn = await buyerQuote()
  assert.equal((await withdraw(withdrawn, { expectedVersion: await v(withdrawn) })).status, 200)
  assert.deepEqual(await flagsOf('buyer', withdrawn), [false, false], 'WITHDRAWN')
  const expired = await buyerQuote()
  await storefrontDb.b2BQuote.update({ where: { id: expired }, data: { status: 'EXPIRED' } })
  assert.deepEqual(await flagsOf('buyer', expired), [false, false], 'EXPIRED')
})

test('F2. staff-created, sales-rep, legacy and another buyer’s quotes come back with both flags false', async () => {
  const staff = (await call('m1', 'POST', '/quotes', { customerRef: customerId, lines: startLines })).body.id as string
  const rep = await buyerQuote()
  await storefrontDb.b2BQuote.update({ where: { id: rep }, data: { createdVia: 'SALES_REP', createdByUserId: uid.rep } })
  const legacy = await buyerQuote()
  await storefrontDb.b2BQuote.update({ where: { id: legacy }, data: { createdVia: null, createdByUserId: null } })
  const otherBuyer = await buyerQuote()
  await storefrontDb.b2BQuote.update({ where: { id: otherBuyer }, data: { createdByUserId: uid.otherCust } })
  for (const [label, id] of [['staff', staff], ['rep', rep], ['legacy', legacy], ['other buyer', otherBuyer]] as const) {
    assert.deepEqual(await flagsOf('buyer', id), [false, false], label)
    // The flag agrees with the endpoint it stands for.
    assert.equal((await edit(id, { expectedVersion: await v(id), notes: 'x' })).status, 403, `${label} edit`)
  }
  // The list carries the same flags, still without creator or approver ids.
  const list = (await call('buyer', 'GET', '/quotes')).body as unknown as Array<Record<string, unknown>>
  const byId = new Map(list.map((r) => [r.id, r]))
  assert.equal(byId.get(staff)!.canEdit, false)
  assert.equal(byId.get(legacy)!.canWithdraw, false)
  const own = list.find((r) => r.status === 'OPEN' && r.canEdit === true)
  assert.ok(own, 'own open quotes are flagged in the list')
  assert.ok(list.every((r) => !('createdByUserId' in r) && !('approvedByUserId' in r)))
})

test('F3. a portal user without portal.quotes sees false; staff responses carry no buyer flags', async () => {
  const id = await buyerQuote('OPEN', 'viewer', viewerCustomerId)
  assert.deepEqual(await flagsOf('viewer', id), [false, false])
  const staffView = await call('m1', 'GET', `/quotes/${id}`)
  assert.ok(!('canEdit' in staffView.body) && !('canWithdraw' in staffView.body), 'staff responses unchanged')
  // Every buyer response type carries them: edit and withdraw answers too.
  const own = await buyerQuote()
  const edited = await edit(own, { expectedVersion: await v(own), notes: 'n' })
  assert.deepEqual([edited.body.canEdit, edited.body.canWithdraw], [true, true])
  const gone = await withdraw(own, { expectedVersion: await v(own) })
  assert.deepEqual([gone.body.status, gone.body.canEdit, gone.body.canWithdraw], ['WITHDRAWN', false, false])
})

test('F4. the exact bodies the portal builds are accepted: decimal-text prices, omitted descriptions, null notes', async () => {
  const id = await buyerQuote('PENDING_APPROVAL')
  // As apps/client buildEditBody sends them (JSON drops `description: undefined`).
  const body = {
    expectedVersion: await v(id),
    lines: [
      { lineNo: 1, skuCode, description: 'Pens', qty: 12, unitPrice: '19.10' },
      { lineNo: 2, skuCode: sku2Code, description: undefined, qty: 2, unitPrice: '0' },
    ],
  }
  const res = await edit(id, body)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.deepEqual(linesOf(await row(id)), [[1, skuCode, 'Pens', 12, '19.1'], [2, sku2Code, 'Pads', 2, '0']])
  assert.equal((await row(id)).status, 'OPEN')
  assert.equal((await edit(id, { expectedVersion: await v(id), notes: null })).status, 200)
  assert.equal((await row(id)).notes, null)
  assert.equal((await withdraw(id, { expectedVersion: await v(id), withdrawReason: 'found another supplier' })).status, 200)
  assert.equal((await row(id)).withdrawReason, 'found another supplier')
})
