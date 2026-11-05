/**
 * Ticket #3, phase 3B-1: orders can name the quote they were placed from (`sourceQuoteId`), and the order database
 * itself allows at most one order per quote per tenant. Nothing populates it yet; every existing order path is unchanged.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma as InvPrisma } from '@/generated/prisma-inventory'
import { Prisma as OrderPrisma } from '@/generated/prisma-order'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, orderDb, tenantDb } from './db'
import { createOrder, findOrderById, listOrders } from './orders'

const PASSWORD = 'order-source-quote-pass-1'
const tenantA = `t-${randomUUID()}`
const tenantB = `t-${randomUUID()}`
const userIds: string[] = []
let managerToken = ''
let customerId = ''
let skuId = ''
let warehouseId = ''

async function makeTenant(id: string) {
  await authDb.tenant.create({ data: { id, name: 'S', slug: `s-${id.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id, slug: `s-${id.slice(-8)}`, displayName: 'S', settings: { salesTaxRate: 0 }, metadata: {} },
  })
}

/** A bare order row, the way the order table is written directly (as in a pre-3B-1 database). */
function rawOrder(tenantId: string, sourceQuoteId?: string | null) {
  return orderDb.order.create({
    data: {
      tenantId,
      customerId: 'cust-raw',
      channel: 'B2B_PORTAL',
      paymentMethod: 'NET_TERMS',
      totalAmount: new OrderPrisma.Decimal('10'),
      ...(sourceQuoteId !== undefined ? { sourceQuoteId } : {}),
    },
  })
}

function isUniqueOnSourceQuote(e: unknown) {
  return (
    e instanceof OrderPrisma.PrismaClientKnownRequestError &&
    e.code === 'P2002' &&
    JSON.stringify(e.meta ?? {}).includes('sourceQuoteId')
  )
}

async function call(method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> }
}

before(async () => {
  await makeTenant(tenantA)
  await makeTenant(tenantB)
  customerId = (await crmDb.customer.create({ data: { tenantId: tenantA, name: 'Order Co', email: `oc-${randomUUID().slice(0, 6)}@example.test` } })).id
  warehouseId = (await inventoryDb.warehouse.create({ data: { tenantId: tenantA, name: 'Main', code: 'MAIN', address: {}, isDefault: true } })).id
  skuId = (await inventoryDb.sKU.create({
    data: { tenantId: tenantA, code: `SQ-${randomUUID().slice(0, 5)}`, name: 'Widget', category: 'x', cost: new InvPrisma.Decimal('5'), price: new InvPrisma.Decimal('24'), imageUrls: [], attributes: {} },
  })).id
  await inventoryDb.stockLevel.create({
    data: { tenantId: tenantA, skuId, warehouseId, batchId: '', quantityOnHand: 100, quantityAvailable: 100 },
  })
  const email = `mgr-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: { tenantId: tenantA, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: 'M', lastName: 'U', role: 'MANAGER', permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  managerToken = (await loginUser(email, PASSWORD)).accessToken
})

after(async () => {
  // Let fire-and-forget pipelines from API-placed orders settle before removing their rows.
  await new Promise((r) => setTimeout(r, 300))
  for (const t of [tenantA, tenantB]) {
    await orderDb.order.deleteMany({ where: { tenantId: t } })
    await inventoryDb.stockReservation.deleteMany({ where: { tenantId: t } })
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

test('an order written without sourceQuoteId (as every existing order is) stays valid and readable', async () => {
  const legacy = await rawOrder(tenantA)
  assert.equal(legacy.sourceQuoteId, null)
  const found = await findOrderById(tenantA, legacy.id)
  assert.equal(found.id, legacy.id)
  const page = await listOrders(tenantA, 1, 50, {})
  const rows = (page as { items?: Array<{ id: string }> }).items ?? (page as unknown as Array<{ id: string }>)
  assert.ok(rows.some((o) => o.id === legacy.id), 'listed as before')
})

test('createOrder without sourceQuoteId works exactly as before and leaves it null, every time', async () => {
  const input = {
    customerId,
    channel: 'SALES_REP',
    paymentMethod: 'NET_TERMS',
    lineItems: [{ skuId, warehouseId, quantity: 1, unitPrice: 24 }],
  }
  const a = await createOrder(tenantA, input, { awaitPipeline: true })
  const b = await createOrder(tenantA, input, { awaitPipeline: true })
  assert.notEqual(a.id, b.id, 'two separate orders, as before')
  for (const o of [a, b]) {
    const stored = await orderDb.order.findUniqueOrThrow({ where: { id: o.id }, include: { lineItems: true } })
    assert.equal(stored.sourceQuoteId, null)
    assert.equal(stored.lineItems.length, 1)
    assert.equal(Number(stored.totalAmount), 24)
    assert.ok(stored.orderNumber, 'still numbered')
  }
})

test('the same non-null sourceQuoteId cannot be committed twice in one tenant (P2002 on the source index)', async () => {
  const quoteId = `q-${randomUUID()}`
  const first = await rawOrder(tenantA, quoteId)
  assert.equal(first.sourceQuoteId, quoteId)
  await assert.rejects(rawOrder(tenantA, quoteId), (e) => {
    assert.ok(isUniqueOnSourceQuote(e), `expected P2002 naming sourceQuoteId, got ${String(e)}`)
    return true
  })
  assert.equal(await orderDb.order.count({ where: { tenantId: tenantA, sourceQuoteId: quoteId } }), 1)
})

test('two inserts for the same quote at the same moment: exactly one commits', async () => {
  const quoteId = `q-${randomUUID()}`
  const results = await Promise.allSettled([rawOrder(tenantA, quoteId), rawOrder(tenantA, quoteId), rawOrder(tenantA, quoteId)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  for (const r of results) if (r.status === 'rejected') assert.ok(isUniqueOnSourceQuote(r.reason), String(r.reason))
  assert.equal(await orderDb.order.count({ where: { tenantId: tenantA, sourceQuoteId: quoteId } }), 1)
})

test('different tenants may each have an order for the same sourceQuoteId', async () => {
  const quoteId = `q-${randomUUID()}`
  const a = await rawOrder(tenantA, quoteId)
  const b = await rawOrder(tenantB, quoteId)
  assert.notEqual(a.id, b.id)
  assert.equal(await orderDb.order.count({ where: { sourceQuoteId: quoteId } }), 2)
})

test('any number of orders may have a null sourceQuoteId in one tenant', async () => {
  const before = await orderDb.order.count({ where: { tenantId: tenantB, sourceQuoteId: null } })
  await rawOrder(tenantB, null)
  await rawOrder(tenantB, null)
  await rawOrder(tenantB)
  assert.equal(await orderDb.order.count({ where: { tenantId: tenantB, sourceQuoteId: null } }), before + 3)
})

test('the constraint is a real unique index in the SQLite database, and the order-number index is separate', async () => {
  const rows = await orderDb.$queryRawUnsafe<Array<{ name: string; sql: string }>>(
    `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Order' AND name LIKE '%sourceQuoteId%'`,
  )
  assert.equal(rows.length, 1)
  assert.match(rows[0].sql, /CREATE UNIQUE INDEX "Order_tenantId_sourceQuoteId_key" ON "Order"\("tenantId", "sourceQuoteId"\)/)
  // A duplicate order number still fails on its own index, so the two can be told apart (needed in phase 3B-2).
  const n = 900000 + Math.floor(Math.random() * 1000)
  await orderDb.order.create({ data: { tenantId: tenantB, orderNumber: n, customerId: 'c', channel: 'POS', paymentMethod: 'CARD', totalAmount: new OrderPrisma.Decimal('1') } })
  await assert.rejects(
    orderDb.order.create({ data: { tenantId: tenantB, orderNumber: n, customerId: 'c', channel: 'POS', paymentMethod: 'CARD', totalAmount: new OrderPrisma.Decimal('1') } }),
    (e) => e instanceof OrderPrisma.PrismaClientKnownRequestError && e.code === 'P2002' && !isUniqueOnSourceQuote(e),
  )
})

test('order API: POST /orders cannot set sourceQuoteId; responses keep their fields and only add sourceQuoteId', async () => {
  const quoteId = `q-${randomUUID()}`
  const created = await call('POST', '/orders', {
    customerId,
    channel: 'SALES_REP',
    paymentMethod: 'NET_TERMS',
    sourceQuoteId: quoteId,
    lineItems: [{ skuId, warehouseId, quantity: 1, unitPrice: 24 }],
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const stored = await orderDb.order.findUniqueOrThrow({ where: { id: created.body.id as string } })
  assert.equal(stored.sourceQuoteId, null, 'a client cannot claim a quote’s single order slot')
  assert.equal(await orderDb.order.count({ where: { tenantId: tenantA, sourceQuoteId: quoteId } }), 0)

  for (const k of ['id', 'tenantId', 'orderNumber', 'customerId', 'channel', 'status', 'totalAmount', 'paymentMethod', 'lineItems']) {
    assert.ok(k in created.body, `create response has ${k}`)
  }
  const detail = await call('GET', `/orders/${created.body.id}`)
  assert.equal(detail.status, 200)
  for (const k of ['id', 'orderNumber', 'customerId', 'status', 'totalAmount', 'lineItems', 'sourceQuoteId']) {
    assert.ok(k in detail.body, `detail response has ${k}`)
  }
  assert.equal(detail.body.sourceQuoteId, null)
  assert.equal((await call('GET', '/orders')).status, 200)
})
