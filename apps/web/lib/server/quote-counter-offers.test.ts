/**
 * Ticket #3, Phase 4: counter-offer security. Who made an offer comes from the session; only the other party may
 * accept it; staff need quotes.write and buyers portal quote access; approved (and later) quotes are frozen; offer
 * lines are validated; acceptance is one versioned transaction that loses cleanly to any competing change.
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

const PASSWORD = 'quote-counter-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
const email = (k: string) => `${k}-${randomUUID().slice(0, 6)}@example.test`
const buyerEmail = email('buyer')
const otherBuyerEmail = email('other')
const viewerEmail = email('viewer')
const skuCode = `CO-${randomUUID().slice(0, 5)}`
const sku2Code = `CO2-${randomUUID().slice(0, 5)}`
let customerId = ''

async function makeUser(key: string, tenantId: string, role: string, opts: { email?: string; permissions?: string[] } = {}) {
  const e = opts.email ?? email(key.toLowerCase())
  const user = await authDb.user.create({
    data: { tenantId, email: e, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role: role as never, permissions: opts.permissions ?? [], emailVerifiedAt: new Date() },
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

const quoteRow = (id: string) => storefrontDb.b2BQuote.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
const offerRow = (id: string) => storefrontDb.quoteCounterOffer.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
const offerCount = (quoteId: string) => storefrontDb.quoteCounterOffer.count({ where: { quoteId } })
const linesOf = (q: Awaited<ReturnType<typeof quoteRow>>) => q.lines.map((l) => [l.lineNo, l.skuCode, l.description, l.qty, Number(l.unitPrice)])

/** A quote of the buyer's: OPEN, or taken to PENDING_APPROVAL / APPROVED. Two lines. */
async function quote(stage: 'OPEN' | 'PENDING_APPROVAL' | 'APPROVED' = 'OPEN'): Promise<string> {
  const created = await call('buyer', 'POST', '/quotes', {
    customerRef: customerId,
    lines: [
      { lineNo: 1, skuCode, description: 'Pens', qty: 10, unitPrice: 20 },
      { lineNo: 2, skuCode: sku2Code, description: 'Pads', qty: 5, unitPrice: 8 },
    ],
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.id as string
  if (stage !== 'OPEN') assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  if (stage === 'APPROVED') assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  return id
}

const twoLines = (q1 = 9, p1 = 18, q2 = 4, p2 = 7) => [
  { lineNo: 1, qty: q1, unitPrice: p1 },
  { lineNo: 2, qty: q2, unitPrice: p2 },
]

async function offer(who: string, quoteId: string, lines: unknown = twoLines(), extra: Record<string, unknown> = {}) {
  return call(who, 'POST', `/quotes/${quoteId}/counter-offers`, { lines, ...extra })
}
const accept = (who: string, quoteId: string, counterOfferId: unknown) =>
  call(who, 'POST', `/quotes/${quoteId}/counter-offers/accept`, { counterOfferId })

/** The quote and offer exactly as they were: nothing about either changed. */
async function unchanged(quoteId: string, before: Awaited<ReturnType<typeof quoteRow>>, offerId?: string, offerStatus = 'OPEN') {
  const now = await quoteRow(quoteId)
  assert.deepEqual([now.status, now.version, linesOf(now)], [before.status, before.version, linesOf(before)], 'quote unchanged')
  if (offerId) {
    const o = await offerRow(offerId)
    assert.deepEqual([o.status, o.acceptedByUserId, o.acceptedAt], [offerStatus, null, null], `offer still ${offerStatus}, never accepted`)
  }
}

/** An OPEN offer row left on a frozen quote (as offers made before this hardening could be). */
const strayOpenOffer = async (quoteId: string) =>
  (await storefrontDb.quoteCounterOffer.create({
    data: { quoteId, offeredBy: 'ADMIN', side: 'STAFF', userId: null, lines: { create: [{ lineNo: 1, qty: 1, unitPrice: new Prisma.Decimal('1') }] } },
  })).id

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
  await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Other Co', email: otherBuyerEmail } })
  await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Viewer Co', email: viewerEmail } })
  const wh = await inventoryDb.warehouse.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN', address: {}, isDefault: true } })
  for (const [code, name] of [[skuCode, 'Pens'], [sku2Code, 'Pads']]) {
    const sku = await inventoryDb.sKU.create({
      data: { tenantId: tenantA, code, name, category: 'Office', cost: new Prisma.Decimal('5'), price: new Prisma.Decimal('24'), imageUrls: [], attributes: {} },
    })
    await inventoryDb.stockLevel.create({ data: { tenantId: tenantA, skuId: sku.id, warehouseId: wh.id, batchId: '', quantityOnHand: 100000, quantityAvailable: 100000 } })
  }
  await makeUser('buyer', tenantA, 'STAFF', { email: buyerEmail }) // portal buyer of Buyer Co
  await makeUser('otherBuyer', tenantA, 'STAFF', { email: otherBuyerEmail }) // portal buyer of Other Co
  await makeUser('viewer', tenantA, 'VIEWER', { email: viewerEmail }) // portal role without portal.quotes
  await makeUser('m1', tenantA, 'MANAGER')
  await makeUser('m2', tenantA, 'MANAGER')
  await makeUser('wh', tenantA, 'WAREHOUSE_STAFF') // staff without any quotes permission
  await makeUser('readOnly', tenantA, 'MANAGER', { permissions: ['quotes.read', 'orders.read'] }) // quotes.read only
  await makeUser('mB', tenantB, 'MANAGER')
})

afterEach(() => setQuoteRaceHookForTests(null))

after(async () => {
  setQuoteRaceHookForTests(null)
  await new Promise((r) => setTimeout(r, 500)) // let fire-and-forget fulfilment finish
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

// ---- 1-2: identity comes from the session ----

test('1. a buyer cannot impersonate ADMIN: offeredBy / userId in the body are ignored', async () => {
  const id = await quote()
  const res = await offer('buyer', id, twoLines(), { offeredBy: 'ADMIN', userId: uid.m1, side: 'STAFF', tenantId: tenantB })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  const row = await offerRow(res.body.id as string)
  assert.deepEqual([row.side, row.offeredBy, row.userId, row.quoteId], ['BUYER', 'BUYER', uid.buyer, id])
  assert.deepEqual([res.body.offeredBy, res.body.side], ['BUYER', 'BUYER'])
  // And so it is still the buyer's own offer: the buyer cannot accept it, staff can.
  assert.equal((await accept('buyer', id, row.id)).status, 403)
  assert.equal((await accept('m1', id, row.id)).status, 200)
})

test('2. staff offers are attributed to the staff member, whatever the body says', async () => {
  const id = await quote()
  const res = await offer('m1', id, twoLines(), { offeredBy: 'BUYER', userId: uid.buyer })
  assert.equal(res.status, 201)
  const row = await offerRow(res.body.id as string)
  assert.deepEqual([row.side, row.offeredBy, row.userId], ['STAFF', 'ADMIN', uid.m1])
})

// ---- 3-6: only the counterparty accepts ----

test('3. a buyer cannot accept their own offer', async () => {
  const id = await quote()
  const o = await offer('buyer', id)
  const before = await quoteRow(id)
  const res = await accept('buyer', id, o.body.id)
  assert.equal(res.status, 403)
  assert.match(String(res.body.message), /your own side/)
  await unchanged(id, before, o.body.id as string)
})

test('4. staff cannot accept a staff offer, including another staff member’s', async () => {
  const id = await quote()
  const o = await offer('m1', id)
  const before = await quoteRow(id)
  assert.equal((await accept('m1', id, o.body.id)).status, 403)
  assert.equal((await accept('m2', id, o.body.id)).status, 403)
  await unchanged(id, before, o.body.id as string)
})

test('5. a buyer accepts a staff offer: lines replaced, offer ACCEPTED by the buyer, version + 1', async () => {
  const id = await quote('PENDING_APPROVAL')
  const o = await offer('m1', id, twoLines(8, 19, 6, 7.5))
  const before = await quoteRow(id)
  const res = await accept('buyer', id, o.body.id)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const q = await quoteRow(id)
  assert.deepEqual([q.status, q.version], ['OPEN', before.version + 1], 'back to OPEN: the new terms need approval again')
  assert.deepEqual(linesOf(q), [[1, skuCode, 'Pens', 8, 19], [2, sku2Code, 'Pads', 6, 7.5]])
  const row = await offerRow(o.body.id as string)
  assert.deepEqual([row.status, row.acceptedByUserId], ['ACCEPTED', uid.buyer])
  assert.ok(row.acceptedAt instanceof Date)
})

test('6. staff accept a buyer offer', async () => {
  const id = await quote()
  const o = await offer('buyer', id, twoLines(11, 17, 5, 8))
  const res = await accept('m2', id, o.body.id)
  assert.equal(res.status, 200)
  assert.deepEqual(linesOf(await quoteRow(id)).map((l) => [l[3], l[4]]), [[11, 17], [5, 8]])
  assert.equal((await offerRow(o.body.id as string)).acceptedByUserId, uid.m2)
})

// ---- 7-9: permissions and isolation ----

test('7. staff without quotes.write cannot make or accept offers; a portal role without quote access neither', async () => {
  const id = await quote()
  const buyerOffer = await offer('buyer', id)
  const before = await quoteRow(id)
  for (const who of ['wh', 'readOnly']) {
    const made = await offer(who, id)
    assert.equal(made.status, 403, `${who} make`)
    assert.match(String(made.body.message), /quotes\.write/)
    assert.equal((await accept(who, id, buyerOffer.body.id)).status, 403, `${who} accept`)
  }
  // VIEWER is a portal role without portal.quotes.
  assert.equal((await offer('viewer', id)).status, 403)
  assert.equal(await offerCount(id), 1)
  await unchanged(id, before, buyerOffer.body.id as string)
})

test('8. another tenant cannot see, make or accept offers on this tenant’s quote', async () => {
  const id = await quote()
  const o = await offer('m1', id)
  const before = await quoteRow(id)
  assert.equal((await offer('mB', id)).status, 404)
  assert.equal((await accept('mB', id, o.body.id)).status, 404)
  assert.equal((await call('mB', 'GET', `/quotes/${id}/counter-offers`)).status, 404)
  // An offer id from tenant A against a quote of tenant B: not found, nothing touched.
  const created = await call('mB', 'POST', '/quotes', { customerRef: 'nobody', lines: [{ lineNo: 1, skuCode: 'X', description: 'X', qty: 1, unitPrice: 1 }] })
  assert.ok(created.status >= 400) // tenant B has no such customer or product; no quote to borrow
  assert.equal(await offerCount(id), 1)
  await unchanged(id, before, o.body.id as string)
})

test('9. another customer’s buyer cannot see, make or accept offers on this quote', async () => {
  const id = await quote()
  const o = await offer('m1', id)
  const before = await quoteRow(id)
  assert.equal((await offer('otherBuyer', id)).status, 404)
  assert.equal((await accept('otherBuyer', id, o.body.id)).status, 404)
  assert.equal((await call('otherBuyer', 'GET', `/quotes/${id}/counter-offers`)).status, 404)
  // An offer id that belongs to a different quote is not found under this one.
  const other = await quote()
  assert.equal((await accept('buyer', other, o.body.id)).status, 404)
  assert.equal(await offerCount(id), 1)
  await unchanged(id, before, o.body.id as string)
})

// ---- 10-13: frozen quotes ----

test('10. an APPROVED quote takes no new offers, from buyers or staff', async () => {
  const id = await quote('APPROVED')
  const before = await quoteRow(id)
  for (const who of ['buyer', 'm1']) {
    const res = await offer(who, id)
    assert.equal(res.status, 400, who)
    assert.match(String(res.body.message), /approved.*new quote/i)
  }
  assert.equal(await offerCount(id), 0)
  await unchanged(id, before)
})

test('11. an APPROVED quote accepts no offer made before approval, from either side', async () => {
  const id = await quote('PENDING_APPROVAL')
  const fromStaff = await offer('m1', id, twoLines(1, 1, 1, 1))
  const fromBuyer = await offer('buyer', id, twoLines(2, 2, 2, 2))
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  const before = await quoteRow(id)
  const a = await accept('buyer', id, fromStaff.body.id)
  const b = await accept('m2', id, fromBuyer.body.id)
  assert.deepEqual([a.status, b.status], [400, 400])
  assert.match(String(a.body.message), /approved/)
  // Approval superseded both; they stay on record, neither was accepted.
  await unchanged(id, before, fromStaff.body.id as string, 'SUPERSEDED')
  await unchanged(id, before, fromBuyer.body.id as string, 'SUPERSEDED')
  // An offer left OPEN on an approved quote (made before approval superseded them) is still refused by the freeze.
  const stray = await strayOpenOffer(id)
  const c = await accept('buyer', id, stray)
  assert.equal(c.status, 400)
  assert.match(String(c.body.message), /approved.*new quote/i)
  await unchanged(id, before, stray)
})

test('12. a SUBMITTED quote (claimed or converted) never changes: no new offers, no acceptance', async () => {
  const id = await quote('PENDING_APPROVAL')
  const o = await offer('m1', id)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  const before = await quoteRow(id)
  assert.equal(before.status, 'SUBMITTED')
  assert.ok(before.convertedOrderId)
  assert.equal((await offer('buyer', id)).status, 400)
  assert.equal((await offer('m1', id)).status, 400)
  assert.equal((await accept('buyer', id, o.body.id)).status, 400, 'superseded at approval')
  await unchanged(id, before, o.body.id as string, 'SUPERSEDED')
  // A stray OPEN offer on the converted quote: the order lock refuses it with 409, as in 3B-2.
  const stray = await strayOpenOffer(id)
  assert.equal((await accept('buyer', id, stray)).status, 409)
  assert.equal(await offerCount(id), 2)
  await unchanged(id, before, stray)

  // Claimed for conversion but not yet linked to an order: just as frozen.
  const id2 = await quote('PENDING_APPROVAL')
  const o2 = await offer('m1', id2)
  await storefrontDb.b2BQuote.update({ where: { id: id2 }, data: { status: 'SUBMITTED', version: { increment: 1 } } })
  const claimed = await quoteRow(id2)
  assert.equal((await offer('buyer', id2)).status, 400)
  assert.equal((await accept('buyer', id2, o2.body.id)).status, 409)
  await unchanged(id2, claimed, o2.body.id as string)
})

test('13. EXPIRED and WITHDRAWN quotes never change', async () => {
  for (const status of ['EXPIRED', 'WITHDRAWN'] as const) {
    const id = await quote()
    const o = await offer('m1', id)
    await storefrontDb.b2BQuote.update({ where: { id }, data: { status, version: { increment: 1 } } })
    const before = await quoteRow(id)
    assert.equal((await offer('buyer', id)).status, 400, `${status} make`)
    assert.equal((await offer('m1', id)).status, 400, `${status} staff make`)
    const res = await accept('buyer', id, o.body.id)
    assert.equal(res.status, 409, `${status} accept`)
    assert.match(String(res.body.message), new RegExp(status.toLowerCase()))
    assert.equal(await offerCount(id), 1)
    await unchanged(id, before, o.body.id as string)
  }
})

// ---- 14-16: line validation ----

test('14. offer lines must be the quote’s own lines naming active products of this tenant', async () => {
  const id = await quote()
  const before = await quoteRow(id)
  for (const [label, lines] of [
    ['line not on the quote', [{ lineNo: 3, qty: 1, unitPrice: 1 }]],
    ['duplicate line', [{ lineNo: 1, qty: 1, unitPrice: 1 }, { lineNo: 1, qty: 2, unitPrice: 2 }]],
    ['more lines than the quote', [...twoLines(), { lineNo: 3, qty: 1, unitPrice: 1 }]],
    ['no lines', []],
    ['not a list', { lineNo: 1, qty: 1, unitPrice: 1 }],
    ['missing', undefined],
    ['line not an object', [7]],
    ['bad lineNo', [{ lineNo: 'one', qty: 1, unitPrice: 1 }]],
  ] as const) {
    // Posted as given: a missing `lines` really is absent from the body (not the helper's default lines).
    const res = await call('buyer', 'POST', `/quotes/${id}/counter-offers`, lines === undefined ? {} : { lines })
    assert.equal(res.status, 400, `${label}: ${JSON.stringify(res.body)}`)
  }
  assert.equal(await offerCount(id), 0)

  // The product behind a quote line is retired: no new offer on it, and an open one can no longer be accepted.
  const o = await offer('m1', id)
  assert.equal(o.status, 201)
  await inventoryDb.sKU.updateMany({ where: { tenantId: tenantA, code: sku2Code }, data: { isActive: false } })
  try {
    const made = await offer('buyer', id)
    assert.equal(made.status, 400)
    assert.match(String(made.body.message), /inactive/)
    const acc = await accept('buyer', id, o.body.id)
    assert.equal(acc.status, 400)
    assert.match(String(acc.body.message), /inactive/)
  } finally {
    await inventoryDb.sKU.updateMany({ where: { tenantId: tenantA, code: sku2Code }, data: { isActive: true } })
  }
  await unchanged(id, before, o.body.id as string)
})

test('15. quantities must be whole numbers from 1 to the order-line maximum', async () => {
  const id = await quote()
  for (const qty of [0, -1, 1.5, '3', null, 1_000_001, true]) {
    const res = await offer('buyer', id, [{ lineNo: 1, qty, unitPrice: 10 }])
    assert.equal(res.status, 400, `qty ${JSON.stringify(qty)}`)
    assert.match(String(res.body.message), /quantity/)
  }
  assert.equal((await offer('buyer', id, [{ lineNo: 1, unitPrice: 10 }])).status, 400, 'qty missing')
  assert.equal(await offerCount(id), 0)
  assert.equal((await offer('buyer', id, [{ lineNo: 1, qty: 1_000_000, unitPrice: 10 }])).status, 201, 'the maximum is allowed')
})

test('16. unit prices must be positive, finite, plain amounts with at most 4 decimals', async () => {
  const id = await quote()
  // NaN and Infinity reach the server as null through JSON; strings are refused unless plain decimals.
  for (const unitPrice of [0, -1, -0.01, null, 'abc', '1e3', '', '12.5.1', 1.12345, 1_000_000_001, {}, [], false]) {
    const res = await offer('buyer', id, [{ lineNo: 1, qty: 1, unitPrice }])
    assert.equal(res.status, 400, `price ${JSON.stringify(unitPrice)}: ${JSON.stringify(res.body)}`)
    assert.match(String(res.body.message), /unit price/)
  }
  assert.equal((await offer('buyer', id, [{ lineNo: 1, qty: 1 }])).status, 400, 'price missing')
  assert.equal(await offerCount(id), 0)
  // Legitimate prices still work: decimals, a decimal string, 4 decimal places.
  const ok = await offer('buyer', id, [{ lineNo: 1, qty: 2, unitPrice: '19.50' }, { lineNo: 2, qty: 3, unitPrice: 0.1234 }])
  assert.equal(ok.status, 201, JSON.stringify(ok.body))
  const row = await offerRow(ok.body.id as string)
  assert.deepEqual(row.lines.map((l) => [l.lineNo, l.qty, l.unitPrice.toString()]), [[1, 2, '19.5'], [2, 3, '0.1234']])
})

// ---- 17-21: atomic acceptance and races ----

test('17. acceptance is all or nothing: if the offer is answered mid-acceptance, the quote is not touched', async () => {
  const id = await quote()
  const o = await offer('m1', id, twoLines(1, 2, 3, 4))
  const before = await quoteRow(id)
  // Something answers the offer without changing the quote (no version bump): the quote guard passes, the offer
  // claim misses, and the whole transaction, including the version bump already made, rolls back.
  onceAt('accept:after-read', async () => {
    await storefrontDb.quoteCounterOffer.update({ where: { id: o.body.id as string }, data: { status: 'ACCEPTED' } })
  })
  const res = await accept('buyer', id, o.body.id)
  assert.equal(res.status, 409)
  const q = await quoteRow(id)
  assert.deepEqual([q.status, q.version, linesOf(q)], [before.status, before.version, linesOf(before)])
  assert.equal((await offerRow(o.body.id as string)).acceptedByUserId, null)
})

test('18. accepting twice changes the quote once', async () => {
  const id = await quote()
  const o = await offer('m1', id, twoLines(3, 3, 3, 3))
  const v0 = (await quoteRow(id)).version
  assert.equal((await accept('buyer', id, o.body.id)).status, 200)
  const again = await accept('buyer', id, o.body.id)
  assert.equal(again.status, 400)
  assert.match(String(again.body.message), /not open/)
  // At the same moment: exactly one lands.
  const id2 = await quote()
  const o2 = await offer('m1', id2, twoLines(4, 4, 4, 4))
  const v2 = (await quoteRow(id2)).version
  const both = await Promise.all([accept('buyer', id2, o2.body.id), accept('buyer', id2, o2.body.id)])
  // Exactly one succeeds. The loser is refused with 409 if it read the offer before the winner committed (its guarded
  // write misses), or 400 "not open" if it read it after; either way it changes nothing (versions checked below).
  const statuses = both.map((r) => r.status).sort()
  assert.equal(statuses[0], 200)
  assert.ok([400, 409].includes(statuses[1]), `loser refused: ${statuses[1]}`)
  const [q, q2] = [await quoteRow(id), await quoteRow(id2)]
  assert.deepEqual([q.version, q2.version], [v0 + 1, v2 + 1])
  assert.equal(q.lines.length, 2)
  assert.equal(q2.lines.length, 2)
  assert.equal((await offerRow(o2.body.id as string)).status, 'ACCEPTED')
})

test('19. two competing offers: only the first acceptance lands; the other is refused and stays open', async () => {
  const id = await quote()
  const a = await offer('m1', id, twoLines(1, 1, 1, 1))
  const b = await offer('m2', id, twoLines(2, 2, 2, 2))
  const v0 = (await quoteRow(id)).version
  // B is accepted between A's read and A's write.
  onceAt('accept:after-read', async () => {
    assert.equal((await accept('buyer', id, b.body.id)).status, 200)
  })
  const res = await accept('buyer', id, a.body.id)
  assert.equal(res.status, 409)
  const q = await quoteRow(id)
  assert.equal(q.version, v0 + 1)
  assert.deepEqual(linesOf(q).map((l) => [l[3], l[4]]), [[2, 2], [2, 2]], 'B’s terms')
  assert.deepEqual([(await offerRow(a.body.id as string)).status, (await offerRow(b.body.id as string)).status], ['SUPERSEDED', 'ACCEPTED'])
  assert.equal((await offerRow(a.body.id as string)).acceptedByUserId, null)
})

test('20. approval racing acceptance: whichever lands first wins; the other gets 409 and changes nothing', async () => {
  // a) approved between the acceptance's read and write: the acceptance is refused, the approved terms stand.
  const id = await quote('PENDING_APPROVAL')
  const o = await offer('buyer', id, twoLines(1, 1, 1, 1))
  const pending = await quoteRow(id)
  onceAt('accept:after-read', async () => {
    assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  })
  const res = await accept('m2', id, o.body.id)
  assert.equal(res.status, 409)
  assert.match(String(res.body.message), /approved/)
  const q = await quoteRow(id)
  assert.deepEqual([q.status, q.version, linesOf(q)], ['APPROVED', pending.version + 1, linesOf(pending)])
  assert.equal((await offerRow(o.body.id as string)).status, 'SUPERSEDED', 'the approval superseded it')

  // b) accepted between the approval's read and write: the approval is refused, never approving terms it didn't see.
  const id2 = await quote('PENDING_APPROVAL')
  const o2 = await offer('buyer', id2, twoLines(6, 6, 6, 6))
  const v2 = (await quoteRow(id2)).version
  onceAt('approve:after-read', async () => {
    assert.equal((await accept('m2', id2, o2.body.id)).status, 200)
  })
  assert.equal((await call('m1', 'POST', `/quotes/${id2}/approve`)).status, 409)
  const q2 = await quoteRow(id2)
  assert.deepEqual([q2.status, q2.version, q2.approvedAt], ['OPEN', v2 + 1, null])
  assert.deepEqual(linesOf(q2).map((l) => [l[3], l[4]]), [[6, 6], [6, 6]])

  // c) a new offer racing an approval: the offer is refused, so none is left on the approved quote.
  const id3 = await quote('PENDING_APPROVAL')
  onceAt('counter:after-read', async () => {
    assert.equal((await call('m1', 'POST', `/quotes/${id3}/approve`)).status, 200)
  })
  const late = await offer('buyer', id3)
  assert.equal(late.status, 409)
  assert.equal(await offerCount(id3), 0)
  assert.equal((await quoteRow(id3)).status, 'APPROVED')
})

test('21. conversion racing acceptance: the order is placed from the approved terms; the acceptance changes nothing', async () => {
  const id = await quote('PENDING_APPROVAL')
  const o = await offer('m1', id, twoLines(99, 1, 99, 1))
  const pending = await quoteRow(id)
  onceAt('accept:after-read', async () => {
    assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
    assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  })
  const res = await accept('buyer', id, o.body.id)
  assert.equal(res.status, 409)
  const q = await quoteRow(id)
  assert.equal(q.status, 'SUBMITTED')
  assert.deepEqual(linesOf(q), linesOf(pending))
  const [order] = await orderDb.order.findMany({ where: { tenantId: tenantA, sourceQuoteId: id }, include: { lineItems: true } })
  assert.deepEqual(order.lineItems.map((li) => li.quantity).sort((x, y) => x - y), [5, 10], 'the order uses the quote’s terms, not the offer’s')
  assert.equal((await offerRow(o.body.id as string)).status, 'SUPERSEDED', 'superseded by the approval, never accepted')
})

// ---- 22: compatibility, legacy offers ----

test('22. existing clients keep working: same paths, the pages’ payloads, the same fields (plus side)', async () => {
  const id = await quote()
  // Exactly what apps/client sends: offeredBy plus every quote line.
  const fromBuyerPage = await offer('buyer', id, twoLines(7, 19, 5, 8), { offeredBy: 'BUYER', notes: '  bulk please  ' })
  assert.equal(fromBuyerPage.status, 201)
  for (const k of ['id', 'quoteId', 'offeredBy', 'userId', 'notes', 'status', 'createdAt', 'lines', 'side']) assert.ok(k in fromBuyerPage.body, k)
  assert.deepEqual([fromBuyerPage.body.notes, fromBuyerPage.body.status], ['bulk please', 'OPEN'])
  const fromAdminPage = await offer('m1', id, twoLines(8, 18, 5, 8), { offeredBy: 'ADMIN' })
  assert.equal(fromAdminPage.status, 201)

  // Both pages list offers with the labels they test for ('BUYER' / 'ADMIN').
  const listed = await call('buyer', 'GET', `/quotes/${id}/counter-offers`)
  assert.equal(listed.status, 200)
  const labels = (listed.body as unknown as Array<{ offeredBy: string }>).map((o) => o.offeredBy).sort()
  assert.deepEqual(labels, ['ADMIN', 'BUYER'])
  assert.equal((await call('m1', 'GET', `/quotes/${id}/counter-offers`)).status, 200)

  // Accept answers with the quote, as before; buyers still never see the creator id.
  const res = await accept('buyer', id, fromAdminPage.body.id)
  assert.equal(res.status, 200)
  for (const k of ['id', 'status', 'lines', 'version', 'quoteNumber', 'customerName']) assert.ok(k in res.body, k)
  assert.ok(!('createdByUserId' in res.body))
  assert.equal((await accept('buyer', id, undefined)).status, 400, 'counterOfferId required, as before')

  // The rest of the quote flow is unchanged: approve and place the order.
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  const placed = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(placed.status, 200)
  assert.ok(placed.body.convertedOrderId)
})

test('22b. legacy offers (no recorded side): buyers never accept them; staff only those labelled BUYER', async () => {
  const id = await quote()
  const legacy = async (offeredBy: string) =>
    (await storefrontDb.quoteCounterOffer.create({
      data: { quoteId: id, offeredBy, userId: null, side: null, lines: { create: [{ lineNo: 1, qty: 3, unitPrice: new Prisma.Decimal('15') }] } },
    })).id
  const forgedAdmin = await legacy('ADMIN') // could have been posted by a buyer before Phase 4
  const fromBuyer = await legacy('BUYER')
  const before = await quoteRow(id)
  const a = await accept('buyer', id, forgedAdmin)
  assert.equal(a.status, 400)
  assert.match(String(a.body.message), /sent again/)
  assert.equal((await accept('m1', id, forgedAdmin)).status, 400, 'staff never accept an ADMIN-labelled legacy offer either')
  assert.equal((await accept('buyer', id, fromBuyer)).status, 400)
  await unchanged(id, before, forgedAdmin)
  assert.equal((await accept('m1', id, fromBuyer)).status, 200, 'staff may accept a buyer-labelled legacy offer')
  const q = await quoteRow(id)
  assert.deepEqual(linesOf(q), [[1, skuCode, 'Pens', 3, 15]], 'accepting a one-line offer drops the other line, as before')
})

// ---- Hardening: stale offers are superseded ----

const statusOf = async (...ids: unknown[]) => Promise.all(ids.map(async (id) => (await offerRow(id as string)).status))
const historyOf = async (quoteId: string) =>
  (await storefrontDb.quoteCounterOffer.findMany({ where: { quoteId }, include: { lines: { orderBy: { lineNo: 'asc' } } }, orderBy: { createdAt: 'asc' } }))
    .map((o) => [o.id, o.side, o.offeredBy, o.userId, o.notes, o.lines.map((l) => [l.lineNo, l.qty, l.unitPrice.toString()])])

test('H1. accepting one offer supersedes every other open offer on the quote, from both sides; history is kept', async () => {
  const id = await quote()
  const s1 = await offer('m1', id, twoLines(1, 11, 1, 11), { notes: 'staff one' })
  const s2 = await offer('m2', id, twoLines(2, 12, 2, 12))
  const b1 = await offer('buyer', id, twoLines(3, 13, 3, 13))
  const historyBefore = await historyOf(id)
  const v0 = (await quoteRow(id)).version
  assert.equal((await accept('buyer', id, s1.body.id)).status, 200)
  assert.deepEqual(await statusOf(s1.body.id, s2.body.id, b1.body.id), ['ACCEPTED', 'SUPERSEDED', 'SUPERSEDED'])
  assert.deepEqual(await historyOf(id), historyBefore, 'every offer and its lines are still there, unchanged')
  const q = await quoteRow(id)
  assert.equal(q.version, v0 + 1)
  assert.deepEqual(linesOf(q).map((l) => [l[3], l[4]]), [[1, 11], [1, 11]])
  for (const o of [s2, b1]) assert.equal((await offerRow(o.body.id as string)).acceptedByUserId, null)
})

test('H2. a superseded offer can never be accepted later; negotiation continues with new offers', async () => {
  const id = await quote()
  const s1 = await offer('m1', id, twoLines(1, 11, 1, 11))
  const b1 = await offer('buyer', id, twoLines(3, 13, 3, 13))
  assert.equal((await accept('buyer', id, s1.body.id)).status, 200)
  const before = await quoteRow(id)
  const late = await accept('m1', id, b1.body.id) // the right counterparty, but the offer is stale
  assert.equal(late.status, 400)
  assert.match(String(late.body.message), /replaced/)
  await unchanged(id, before, b1.body.id as string, 'SUPERSEDED')
  // A new offer against the new terms works as before.
  const b2 = await offer('buyer', id, twoLines(4, 14, 4, 14))
  assert.equal(b2.status, 201)
  assert.equal((await accept('m1', id, b2.body.id)).status, 200)
  assert.deepEqual(await statusOf(s1.body.id, b1.body.id, b2.body.id), ['ACCEPTED', 'SUPERSEDED', 'ACCEPTED'])
})

test('H3. approval supersedes open offers in the same transaction; accepted history untouched; a failed approval changes nothing', async () => {
  const id = await quote()
  const s1 = await offer('m1', id, twoLines(5, 15, 5, 15))
  assert.equal((await accept('buyer', id, s1.body.id)).status, 200)
  const acceptedBefore = await offerRow(s1.body.id as string)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  const b1 = await offer('buyer', id, twoLines(6, 16, 6, 16))
  const s2 = await offer('m2', id, twoLines(7, 17, 7, 17))
  const historyBefore = await historyOf(id)

  // An approval that loses its version guard (a competing change lands first) supersedes nothing.
  onceAt('approve:after-read', async () => {
    await storefrontDb.b2BQuote.update({ where: { id }, data: { version: { increment: 1 } } })
  })
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 409)
  assert.deepEqual(await statusOf(b1.body.id, s2.body.id), ['OPEN', 'OPEN'], 'rolled back with the approval')

  const v = (await quoteRow(id)).version
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  const q = await quoteRow(id)
  assert.deepEqual([q.status, q.version], ['APPROVED', v + 1], 'approval protections unchanged: one version step')
  assert.deepEqual(await statusOf(s1.body.id, b1.body.id, s2.body.id), ['ACCEPTED', 'SUPERSEDED', 'SUPERSEDED'])
  const acceptedAfter = await offerRow(s1.body.id as string)
  assert.deepEqual(
    [acceptedAfter.acceptedByUserId, acceptedAfter.acceptedAt?.getTime()],
    [acceptedBefore.acceptedByUserId, acceptedBefore.acceptedAt?.getTime()],
    'the accepted offer record is untouched',
  )
  assert.deepEqual(await historyOf(id), historyBefore)
  assert.equal((await accept('m1', id, b1.body.id)).status, 400)
  assert.equal((await accept('buyer', id, s2.body.id)).status, 400)
})

test('H4. two different offers accepted at the same moment: one lands, the other ends SUPERSEDED, terms changed once', async () => {
  for (let round = 0; round < 3; round++) {
    const id = await quote()
    const a = await offer('m1', id, twoLines(1, 21, 1, 21))
    const b = await offer('m2', id, twoLines(2, 22, 2, 22))
    const v0 = (await quoteRow(id)).version
    const results = await Promise.all([accept('buyer', id, a.body.id), accept('buyer', id, b.body.id)])
    const codes = results.map((r) => r.status)
    assert.equal(codes.filter((c) => c === 200).length, 1, `exactly one acceptance: ${codes}`)
    assert.ok(codes.every((c) => [200, 400, 409].includes(c)), `${codes}`)
    const statuses = await statusOf(a.body.id, b.body.id)
    assert.deepEqual([...statuses].sort(), ['ACCEPTED', 'SUPERSEDED'])
    const q = await quoteRow(id)
    assert.equal(q.version, v0 + 1)
    const winner = statuses[0] === 'ACCEPTED' ? 21 : 22
    assert.deepEqual(linesOf(q).map((l) => l[4]), [winner, winner], 'the quote carries the winner terms only')
  }
})

test('H5. superseding is confined to the quote: other quotes keep their open offers; other tenants and customers see nothing', async () => {
  const id = await quote()
  const other = await quote()
  const a = await offer('m1', id)
  const b = await offer('m2', id)
  const elsewhere = await offer('m1', other)
  assert.equal((await accept('buyer', id, a.body.id)).status, 200)
  assert.deepEqual(await statusOf(b.body.id, elsewhere.body.id), ['SUPERSEDED', 'OPEN'])
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  assert.equal((await offerRow(elsewhere.body.id as string)).status, 'OPEN', 'approving one quote supersedes nothing elsewhere')
  for (const who of ['mB', 'otherBuyer']) {
    assert.equal((await call(who, 'GET', `/quotes/${id}/counter-offers`)).status, 404, who)
    assert.equal((await accept(who, id, b.body.id)).status, 404, who)
  }
})

test('H6. permissions are unchanged: superseded or not, unauthorised callers are refused first', async () => {
  const id = await quote()
  const s1 = await offer('m1', id)
  const b1 = await offer('buyer', id)
  for (const who of ['wh', 'readOnly']) assert.equal((await accept(who, id, b1.body.id)).status, 403, who)
  assert.equal((await accept('buyer', id, b1.body.id)).status, 403, 'own side')
  assert.equal((await accept('buyer', id, s1.body.id)).status, 200)
  // Now superseded: still 403 for callers without the right to accept at all.
  for (const who of ['wh', 'readOnly', 'viewer']) assert.equal((await accept(who, id, b1.body.id)).status, 403, who)
  assert.equal((await offerRow(b1.body.id as string)).status, 'SUPERSEDED')
})

test('H7. buyers no longer receive internal user ids on counter-offers; staff responses are unchanged', async () => {
  const id = await quote()
  const s1 = await offer('m1', id, twoLines(1, 31, 1, 31), { notes: 'staff terms' })
  await offer('buyer', id)
  assert.equal((await accept('buyer', id, s1.body.id)).status, 200)

  const forBuyer = (await call('buyer', 'GET', `/quotes/${id}/counter-offers`)).body as unknown as Array<Record<string, unknown>>
  assert.equal(forBuyer.length, 2)
  for (const o of forBuyer) {
    assert.ok(!('userId' in o) && !('acceptedByUserId' in o), 'no user ids for buyers')
    for (const k of ['id', 'offeredBy', 'status', 'notes', 'createdAt', 'lines']) assert.ok(k in o, `buyer still gets ${k}`)
  }
  assert.ok(!JSON.stringify(forBuyer).includes(uid.m1), 'the staff user id appears nowhere')
  const accepted = forBuyer.find((o) => o.id === s1.body.id)!
  assert.deepEqual([accepted.status, accepted.offeredBy, accepted.notes], ['ACCEPTED', 'ADMIN', 'staff terms'])

  const forStaff = (await call('m1', 'GET', `/quotes/${id}/counter-offers`)).body as unknown as Array<Record<string, unknown>>
  const staffView = forStaff.find((o) => o.id === s1.body.id)!
  assert.deepEqual([staffView.userId, staffView.acceptedByUserId], [uid.m1, uid.buyer], 'staff still see who made and accepted it')
})

test('H8. conversion is unaffected: an approved quote with superseded offers converts from its own terms', async () => {
  const id = await quote('PENDING_APPROVAL')
  const o = await offer('m1', id, twoLines(77, 1, 77, 1))
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200)
  const [order] = await orderDb.order.findMany({ where: { tenantId: tenantA, sourceQuoteId: id }, include: { lineItems: true } })
  assert.equal(res.body.convertedOrderId, order.id)
  assert.deepEqual(order.lineItems.map((li) => li.quantity).sort((x, y) => x - y), [5, 10])
  assert.equal((await offerRow(o.body.id as string)).status, 'SUPERSEDED')
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).body.convertedOrderId, order.id, 'repeat is idempotent')
})
