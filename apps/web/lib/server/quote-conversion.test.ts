/**
 * Ticket #3, phase 3B-2: quote → order conversion across two databases (storefront, order) without a shared
 * transaction. The claim is version-guarded, the order is built from the claimed snapshot, the order database
 * allows one order per quote, and crashes / retries reconcile from the order database.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { Prisma as OrderPrisma } from '@/generated/prisma-order'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, orderDb, storefrontDb, tenantDb, wmsDb } from './db'
import { CONVERSION_RECOVERY_MS, setQuoteRaceHookForTests, type QuoteRacePoint } from './quotes'
import { createOrder, DuplicateSourceOrderError, isSourceQuoteConflict, setOrderFaultForTests } from './orders'

const PASSWORD = 'quote-conversion-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const buyerEmail = `buyer-${randomUUID().slice(0, 6)}@example.test`
const otherBuyerEmail = `other-${randomUUID().slice(0, 6)}@example.test`
const skuCode = `CV-${randomUUID().slice(0, 5)}`
let customerId = ''
let skuId = ''
let warehouseId = ''

type Role = 'STAFF' | 'MANAGER' | 'WAREHOUSE_STAFF'
async function makeUser(key: string, tenantId: string, role: Role, email = `${key.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`) {
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role, permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
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
  await authDb.tenant.create({ data: { id, name: 'V', slug: `v-${id.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id, slug: `v-${id.slice(-8)}`, displayName: 'V', settings: { salesTaxRate: 0 }, metadata: {} },
  })
}

const quoteRow = (id: string) => storefrontDb.b2BQuote.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: 'asc' } } } })
const ordersFor = (id: string, tenantId = tenantA) =>
  orderDb.order.findMany({ where: { tenantId, sourceQuoteId: id }, include: { lineItems: true } })

async function approvedQuote(qty = 10, unitPrice = 20): Promise<string> {
  const created = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [{ lineNo: 1, skuCode, description: 'Pens', qty, unitPrice }] })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.id as string
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  return id
}

/** A quote awaiting approval (counter-offers can still be made on it). */
async function pendingQuote(qty = 10, unitPrice = 20): Promise<string> {
  const created = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [{ lineNo: 1, skuCode, description: 'Pens', qty, unitPrice }] })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.id as string
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/request-approval`)).status, 200)
  return id
}

/** Makes a conversion claim look older than the recovery window (as after a crash a while ago). */
async function ageClaim(id: string) {
  await storefrontDb.b2BQuote.update({ where: { id }, data: { updatedAt: new Date(Date.now() - CONVERSION_RECOVERY_MS - 60_000) } })
  const q = await quoteRow(id)
  assert.ok(Date.now() - q.updatedAt.getTime() > CONVERSION_RECOVERY_MS, 'claim is past the recovery window')
}

/** Runs `fn` the first time `point` is reached; nested requests pass straight through. */
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
  warehouseId = (await inventoryDb.warehouse.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN', address: {}, isDefault: true } })).id
  skuId = (await inventoryDb.sKU.create({
    data: { tenantId: tenantA, code: skuCode, name: 'Pens', category: 'Office', cost: new Prisma.Decimal('9'), price: new Prisma.Decimal('24'), imageUrls: [], attributes: {} },
  })).id
  await inventoryDb.stockLevel.create({
    data: { tenantId: tenantA, skuId, warehouseId, batchId: '', quantityOnHand: 100000, quantityAvailable: 100000 },
  })
  await makeUser('buyer', tenantA, 'STAFF', buyerEmail)
  await makeUser('otherBuyer', tenantA, 'STAFF', otherBuyerEmail)
  await makeUser('m1', tenantA, 'MANAGER')
  await makeUser('wh', tenantA, 'WAREHOUSE_STAFF')
  await makeUser('mB', tenantB, 'MANAGER')
})

afterEach(() => setQuoteRaceHookForTests(null))

after(async () => {
  setQuoteRaceHookForTests(null)
  await new Promise((r) => setTimeout(r, 500)) // let fire-and-forget fulfilment pipelines finish
  for (const t of [tenantA, tenantB]) {
    await storefrontDb.quoteCounterOffer.deleteMany({ where: { quoteId: { in: (await storefrontDb.b2BQuote.findMany({ where: { tenantId: t }, select: { id: true } })).map((q) => q.id) } } })
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

// ---- 1-3: the happy path ----

test('1. a successful conversion places one order tagged with the quote and links it', async () => {
  const id = await approvedQuote()
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const q = await quoteRow(id)
  const placed = await ordersFor(id)
  assert.equal(placed.length, 1)
  assert.deepEqual([q.status, q.convertedOrderId, res.body.convertedOrderId], ['SUBMITTED', placed[0].id, placed[0].id])
  assert.equal(placed[0].sourceQuoteId, id)
  assert.equal(placed[0].channel, 'B2B_PORTAL')
  assert.deepEqual([placed[0].lineItems[0].quantity, Number(placed[0].lineItems[0].unitPrice)], [10, 20], 'approved quantity and price')
})

test('2. the claim moves APPROVED → SUBMITTED at version +1, the link at +1 again', async () => {
  const id = await approvedQuote()
  const approved = await quoteRow(id)
  let atClaim: Awaited<ReturnType<typeof quoteRow>> | undefined
  onceAt('submit:after-claim', async () => {
    atClaim = await quoteRow(id)
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  assert.deepEqual([atClaim!.status, atClaim!.version, atClaim!.convertedOrderId], ['SUBMITTED', approved.version + 1, null])
  const done = await quoteRow(id)
  assert.equal(done.version, approved.version + 2)
})

test('3. the order is built from the lines of the claimed version, not from the earlier read', async () => {
  const id = await approvedQuote(10)
  // A writer that changes a line without moving the version (as legacy code could), between read and claim.
  onceAt('submit:after-read', async () => {
    await storefrontDb.quoteLine.updateMany({ where: { quoteId: id, lineNo: 1 }, data: { qty: 7 } })
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  const [order] = await ordersFor(id)
  assert.equal(order.lineItems[0].quantity, 7, 'snapshot taken with the claim')
})

// ---- 4-5: repeats and races ----

test('4. repeating the request after success returns the same order and places nothing new', async () => {
  const id = await approvedQuote()
  const first = await call('buyer', 'POST', `/quotes/${id}/submit`)
  const again = await call('buyer', 'POST', `/quotes/${id}/submit`)
  const staff = await call('m1', 'POST', `/quotes/${id}/submit`)
  assert.deepEqual([again.status, staff.status], [200, 200])
  assert.equal(again.body.convertedOrderId, first.body.convertedOrderId)
  assert.equal(staff.body.convertedOrderId, first.body.convertedOrderId)
  assert.equal((await ordersFor(id)).length, 1)
})

test('5. concurrent conversions commit exactly one order', async () => {
  const id = await approvedQuote()
  // Deterministic: a second request arrives while the first holds the claim.
  let inner = 0
  onceAt('submit:after-claim', async () => {
    const r = await call('m1', 'POST', `/quotes/${id}/submit`)
    inner = r.status
    assert.equal(r.body.convertedOrderId, null, 'the second request reports the conversion in progress')
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  assert.equal(inner, 200)
  assert.equal((await ordersFor(id)).length, 1)

  // And at the same moment, without the hook.
  const id2 = await approvedQuote()
  const results = await Promise.all([
    call('buyer', 'POST', `/quotes/${id2}/submit`),
    call('buyer', 'POST', `/quotes/${id2}/submit`),
    call('m1', 'POST', `/quotes/${id2}/submit`),
  ])
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200])
  const placed = await ordersFor(id2)
  assert.equal(placed.length, 1)
  assert.equal((await quoteRow(id2)).convertedOrderId, placed[0].id)
})

// ---- 6-10: crashes, failures, recovery ----

test('6. crash after the claim, before any order: left alone for 2 minutes, then recovered with one order', async () => {
  const id = await approvedQuote()
  onceAt('submit:after-claim', async () => {
    throw new Error('simulated crash after claim')
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 500)
  const stuck = await quoteRow(id)
  assert.deepEqual([stuck.status, stuck.convertedOrderId, (await ordersFor(id)).length], ['SUBMITTED', null, 0])

  const early = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(early.status, 200)
  assert.equal(early.body.convertedOrderId, null, 'inside the recovery window the claim is not taken over')
  assert.equal((await ordersFor(id)).length, 0)
  assert.equal((await quoteRow(id)).version, stuck.version, 'nothing changed')

  await ageClaim(id)
  const late = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(late.status, 200, JSON.stringify(late.body))
  const placed = await ordersFor(id)
  assert.equal(placed.length, 1)
  const q = await quoteRow(id)
  assert.deepEqual([q.status, q.convertedOrderId, q.version], ['SUBMITTED', placed[0].id, stuck.version + 2], 're-claimed (+1) then linked (+1)')
})

test('7. crash after the order is saved, before the quote is linked: the retry links that order, no second one', async () => {
  const id = await approvedQuote()
  onceAt('submit:after-create', async () => {
    throw new Error('simulated crash after order commit')
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 500)
  const orphan = await ordersFor(id)
  assert.equal(orphan.length, 1)
  assert.deepEqual([(await quoteRow(id)).status, (await quoteRow(id)).convertedOrderId], ['SUBMITTED', null])

  const retry = await call('buyer', 'POST', `/quotes/${id}/submit`) // inside the window: the order database decides
  assert.equal(retry.status, 200)
  assert.equal(retry.body.convertedOrderId, orphan[0].id)
  assert.equal((await ordersFor(id)).length, 1)
})

test('7b. createOrder fails after the order is saved: the claim is NOT released; the order is linked, the error reported', async () => {
  const id = await approvedQuote()
  setOrderFaultForTests(() => {
    throw new Error('simulated failure after the order insert')
  })
  let res
  try {
    res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  } finally {
    setOrderFaultForTests(null)
  }
  assert.equal(res.status, 500, 'the failure is still reported')
  const placed = await ordersFor(id)
  assert.equal(placed.length, 1)
  const q = await quoteRow(id)
  assert.deepEqual([q.status, q.convertedOrderId], ['SUBMITTED', placed[0].id], 'linked, never released to APPROVED')
  const retry = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(retry.status, 200)
  assert.equal(retry.body.convertedOrderId, placed[0].id)
  assert.equal((await ordersFor(id)).length, 1, 'the retry did not place a second order')
})

test('8. an existing order for an APPROVED quote (released claim raced its insert) is linked, not placed again', async () => {
  const id = await approvedQuote()
  const existing = await orderDb.order.create({
    data: { tenantId: tenantA, customerId, channel: 'B2B_PORTAL', paymentMethod: 'NET_TERMS', totalAmount: new OrderPrisma.Decimal('200'), sourceQuoteId: id },
  })
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200)
  assert.equal(res.body.convertedOrderId, existing.id)
  assert.equal((await ordersFor(id)).length, 1)
  assert.equal((await quoteRow(id)).status, 'SUBMITTED')
})

test('9. a failure before any order exists releases the claim to APPROVED (after confirming no order); retry then works', async () => {
  const id = await approvedQuote()
  const approved = await quoteRow(id)
  await crmDb.customer.update({ where: { id: customerId }, data: { isActive: false } })
  try {
    const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
    assert.equal(res.status, 409, JSON.stringify(res.body)) // createOrder's existing "deactivated" refusal
    const q = await quoteRow(id)
    assert.deepEqual([q.status, q.convertedOrderId, q.version], ['APPROVED', null, approved.version + 2], 'claimed (+1), released (+1)')
    assert.equal((await ordersFor(id)).length, 0)
  } finally {
    await crmDb.customer.update({ where: { id: customerId }, data: { isActive: true } })
  }
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  assert.equal((await ordersFor(id)).length, 1)
})

test('10a. order database unavailable after a failure: the claim is kept (never assumed "no order"), 503, safe retry', async () => {
  const id = await approvedQuote()
  let lookups = 0
  setQuoteRaceHookForTests(async (p) => {
    if (p !== 'submit:order-lookup') return
    lookups += 1
    if (lookups === 2) throw new Error('order database unavailable') // the lookup after the failed placement
  })
  await crmDb.customer.update({ where: { id: customerId }, data: { isActive: false } })
  try {
    const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
    assert.equal(res.status, 503, JSON.stringify(res.body))
    const q = await quoteRow(id)
    assert.deepEqual([q.status, q.convertedOrderId], ['SUBMITTED', null], 'claim kept, not released to APPROVED')
    assert.equal((await ordersFor(id)).length, 0)
  } finally {
    setQuoteRaceHookForTests(null)
    await crmDb.customer.update({ where: { id: customerId }, data: { isActive: true } })
  }
  await ageClaim(id)
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  assert.equal((await ordersFor(id)).length, 1)
})

test('10b. order database unavailable during recovery: 503, nothing changes, no order', async () => {
  const id = await approvedQuote()
  onceAt('submit:after-claim', async () => {
    throw new Error('simulated crash after claim')
  })
  await call('buyer', 'POST', `/quotes/${id}/submit`)
  await ageClaim(id)
  const before = await quoteRow(id)
  setQuoteRaceHookForTests(async (p) => {
    if (p === 'submit:order-lookup') throw new Error('order database unavailable')
  })
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 503)
  const q = await quoteRow(id)
  assert.deepEqual([q.status, q.version, q.convertedOrderId], [before.status, before.version, null])
  assert.equal((await ordersFor(id)).length, 0)
})

// ---- 11-12: the database constraint ----

test('11. losing the insert race (P2002 on sourceQuoteId) links the winning order; createOrder reports it as a duplicate', async () => {
  const id = await approvedQuote()
  let winnerId = ''
  onceAt('submit:after-claim', async () => {
    // Another worker commits the quote's order first.
    winnerId = (await orderDb.order.create({
      data: { tenantId: tenantA, customerId, channel: 'B2B_PORTAL', paymentMethod: 'NET_TERMS', totalAmount: new OrderPrisma.Decimal('200'), sourceQuoteId: id },
    })).id
  })
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.convertedOrderId, winnerId)
  assert.equal((await ordersFor(id)).length, 1)

  // At the service level: the second insert for one quote rolls back and names the first order.
  const src = `q-${randomUUID()}`
  const input = { customerId, channel: 'SALES_REP', paymentMethod: 'NET_TERMS', lineItems: [{ skuId, warehouseId, quantity: 1, unitPrice: 20 }] }
  const first = await createOrder(tenantA, input, { sourceQuoteId: src, skipPriceValidation: true, awaitPipeline: true })
  await assert.rejects(createOrder(tenantA, input, { sourceQuoteId: src, skipPriceValidation: true, awaitPipeline: true }), (e) => {
    assert.ok(e instanceof DuplicateSourceOrderError)
    assert.equal(e.orderId, first.id)
    return true
  })
  assert.equal(await orderDb.order.count({ where: { tenantId: tenantA, sourceQuoteId: src } }), 1)
  assert.equal(await orderDb.orderSaga.count({ where: { orderId: first.id } }), 1, 'the loser started no pipeline')
})

test('12. a duplicate order number is not mistaken for a quote conflict: no order, claim released, retry works', async () => {
  const id = await approvedQuote()
  const taken = await createOrder(tenantA, { customerId, channel: 'SALES_REP', paymentMethod: 'NET_TERMS', lineItems: [{ skuId, warehouseId, quantity: 1, unitPrice: 20 }] }, { skipPriceValidation: true, awaitPipeline: true })
  const counter = await orderDb.orderCounter.findUniqueOrThrow({ where: { tenantId: tenantA } })
  // Wind the counter back so the next order number collides with an existing order.
  await orderDb.orderCounter.update({ where: { tenantId: tenantA }, data: { lastNumber: taken.orderNumber! - 1 } })
  try {
    const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
    assert.equal(res.status, 409, JSON.stringify(res.body)) // P2002 surfaces as the existing generic conflict
    const q = await quoteRow(id)
    assert.deepEqual([q.status, q.convertedOrderId], ['APPROVED', null], 'not linked to anything, claim released')
    assert.equal((await ordersFor(id)).length, 0)
  } finally {
    await orderDb.orderCounter.update({ where: { tenantId: tenantA }, data: { lastNumber: counter.lastNumber + 10 } })
  }
  // And the classifier tells the two apart directly.
  await assert.rejects(
    orderDb.order.create({ data: { tenantId: tenantA, orderNumber: taken.orderNumber, customerId, channel: 'POS', paymentMethod: 'CARD', totalAmount: new OrderPrisma.Decimal('1') } }),
    (e) => isSourceQuoteConflict(e) === false && (e as { code?: string }).code === 'P2002',
  )
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  assert.equal((await ordersFor(id)).length, 1)
})

// ---- 13-14: other writers racing the claim ----

test('13. a version change between read and claim (an edit) stops the conversion: 409, no order, still APPROVED', async () => {
  const id = await approvedQuote()
  onceAt('submit:after-read', async () => {
    await storefrontDb.b2BQuote.updateMany({ where: { id }, data: { version: { increment: 1 } } })
  })
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 409)
  assert.deepEqual([(await quoteRow(id)).status, (await ordersFor(id)).length], ['APPROVED', 0])
})

test('14. counter-offer acceptance cannot change a quote being converted or converted; other statuses unchanged', async () => {
  // Phase 4: approved quotes take no new counter-offers and approval supersedes open ones, so the offer accepted
  // during conversion is an OPEN row left on the approved quote (as one made before that hardening could be).
  // a) accepted while the quote is claimed: refused, the order uses the claimed lines
  const id = await pendingQuote(10, 20)
  assert.equal((await call('m1', 'POST', `/quotes/${id}/approve`)).status, 200)
  const offer = {
    body: {
      id: (await storefrontDb.quoteCounterOffer.create({
        data: { quoteId: id, offeredBy: 'ADMIN', side: 'STAFF', lines: { create: [{ lineNo: 1, qty: 99, unitPrice: new OrderPrisma.Decimal('1') }] } },
      })).id,
    },
  }
  let accept = 0
  onceAt('submit:after-claim', async () => {
    accept = (await call('buyer', 'POST', `/quotes/${id}/counter-offers/accept`, { counterOfferId: offer.body.id })).status
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/submit`)).status, 200)
  assert.equal(accept, 409)
  const [order] = await ordersFor(id)
  assert.deepEqual([order.lineItems[0].quantity, Number(order.lineItems[0].unitPrice)], [10, 20])
  const after = await quoteRow(id)
  assert.deepEqual([after.lines[0].qty, Number(after.lines[0].unitPrice), after.status], [10, 20, 'SUBMITTED'])

  // b) accepted on the converted quote: refused, nothing changes, offer stays open
  assert.equal((await call('buyer', 'POST', `/quotes/${id}/counter-offers/accept`, { counterOfferId: offer.body.id })).status, 409)
  assert.equal((await storefrontDb.quoteCounterOffer.findUniqueOrThrow({ where: { id: offer.body.id as string } })).status, 'OPEN')
  assert.equal((await quoteRow(id)).lines[0].qty, 10)

  // c) an approval and a conversion land between the accept's read (quote still pending) and its write: refused
  const id2 = await pendingQuote(10, 20)
  const offer2 = await call('m1', 'POST', `/quotes/${id2}/counter-offers`, { offeredBy: 'ADMIN', lines: [{ lineNo: 1, qty: 50, unitPrice: 2 }] })
  assert.equal(offer2.status, 201)
  onceAt('accept:after-read', async () => {
    assert.equal((await call('m1', 'POST', `/quotes/${id2}/approve`)).status, 200)
    assert.equal((await call('m1', 'POST', `/quotes/${id2}/submit`)).status, 200)
  })
  assert.equal((await call('buyer', 'POST', `/quotes/${id2}/counter-offers/accept`, { counterOfferId: offer2.body.id })).status, 409)
  const [order2] = await ordersFor(id2)
  assert.equal(order2.lineItems[0].quantity, 10)
  assert.deepEqual([(await quoteRow(id2)).lines[0].qty, (await quoteRow(id2)).status], [10, 'SUBMITTED'])

  // d) unaffected statuses behave as before: accepting on an OPEN quote rewrites the lines and bumps the version
  const open = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [{ lineNo: 1, skuCode, description: 'Pens', qty: 3, unitPrice: 20 }] })
  const openId = open.body.id as string
  const o3 = await call('m1', 'POST', `/quotes/${openId}/counter-offers`, { offeredBy: 'ADMIN', lines: [{ lineNo: 1, qty: 4, unitPrice: 18 }] })
  const v0 = (await quoteRow(openId)).version
  assert.equal((await call('buyer', 'POST', `/quotes/${openId}/counter-offers/accept`, { counterOfferId: o3.body.id })).status, 200)
  const accepted = await quoteRow(openId)
  assert.deepEqual([accepted.status, accepted.lines[0].qty, Number(accepted.lines[0].unitPrice), accepted.lines[0].skuCode, accepted.version], ['OPEN', 4, 18, skuCode, v0 + 1])
  assert.equal((await storefrontDb.quoteCounterOffer.findUniqueOrThrow({ where: { id: o3.body.id as string } })).status, 'ACCEPTED')
  assert.equal((await call('buyer', 'POST', `/quotes/${openId}/counter-offers/accept`, { counterOfferId: o3.body.id })).status, 400, 'already accepted: existing answer')
})

// ---- 15-16: isolation and contract ----

test('15. tenant isolation: other tenants and customers get 404; another tenant’s order with the same quote id is not adopted', async () => {
  const id = await approvedQuote()
  assert.equal((await call('mB', 'POST', `/quotes/${id}/submit`)).status, 404)
  assert.equal((await call('otherBuyer', 'POST', `/quotes/${id}/submit`)).status, 404)
  const foreign = await orderDb.order.create({
    data: { tenantId: tenantB, customerId: 'c-b', channel: 'B2B_PORTAL', paymentMethod: 'NET_TERMS', totalAmount: new OrderPrisma.Decimal('1'), sourceQuoteId: id },
  })
  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200)
  const own = await ordersFor(id, tenantA)
  assert.equal(own.length, 1)
  assert.notEqual(own[0].id, foreign.id)
  assert.equal(res.body.convertedOrderId, own[0].id)
  assert.equal((await ordersFor(id, tenantB)).length, 1, 'tenant B order untouched')
})

test('16. the public API is unchanged: same path, no body, same answers and fields; permissions as before', async () => {
  const notApproved = await call('buyer', 'POST', '/quotes', { customerRef: customerId, lines: [{ lineNo: 1, skuCode, description: 'Pens', qty: 1, unitPrice: 20 }] })
  const bad = await call('buyer', 'POST', `/quotes/${notApproved.body.id}/submit`)
  assert.deepEqual([bad.status, bad.body.message], [400, 'Quote must be approved before placing an order'])

  const id = await approvedQuote()
  assert.equal((await call('wh', 'POST', `/quotes/${id}/submit`)).status, 403, 'staff without orders.write')
  assert.deepEqual([(await quoteRow(id)).status, (await ordersFor(id)).length], ['APPROVED', 0])

  const res = await call('buyer', 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 200)
  for (const k of ['id', 'tenantId', 'customerRef', 'status', 'notes', 'convertedOrderId', 'rejectionReason', 'approvedAt', 'createdAt', 'updatedAt', 'lines', 'version', 'customerName', 'quoteNumber']) {
    assert.ok(k in res.body, `submit response has ${k}`)
  }
  assert.ok(!('createdByUserId' in res.body), 'buyers still do not see the creator id')
  assert.ok(!('approvedByUserId' in res.body), 'nor, since Phase 5, the approver id')

  const staffId = await approvedQuote()
  const staff = await call('m1', 'POST', `/quotes/${staffId}/submit`, {})
  assert.equal(staff.status, 200)
  assert.equal((await ordersFor(staffId))[0].channel, 'SALES_REP')
})
