import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, orderDb, storefrontDb, tenantDb } from './db'

const PASSWORD = 'quote-to-order-pass-1'
const tenantId = `t-${randomUUID()}`
const buyerEmail = `buyer-${randomUUID().slice(0, 6)}@example.test`
const userIds: string[] = []
let customerId = ''
let skuCode = ''

const tokens = new Map<string, Promise<string>>()
function login(role: 'STAFF' | 'MANAGER' | 'WAREHOUSE_STAFF', email?: string) {
  const key = email ?? role
  if (!tokens.has(key)) tokens.set(key, createLogin(role, email))
  return tokens.get(key)!
}

async function createLogin(role: 'STAFF' | 'MANAGER' | 'WAREHOUSE_STAFF', email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`) {
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: role, lastName: 'U', role, permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  return (await loginUser(email, PASSWORD)).accessToken
}

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> }
}

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'Q', slug: `q-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `q-${tenantId.slice(-8)}`, displayName: 'Q', settings: { salesTaxRate: 0 }, metadata: {} },
  })
  customerId = (await crmDb.customer.create({ data: { tenantId, name: 'Buyer Co', email: buyerEmail } })).id
  const wh = await inventoryDb.warehouse.create({ data: { tenantId, name: 'Main', code: 'MAIN', address: {}, isDefault: true } })
  skuCode = 'OFF-PEN-100'
  const sku = await inventoryDb.sKU.create({
    data: { tenantId, code: skuCode, name: 'Office Pen Pack', category: 'Office', cost: new Prisma.Decimal('9'), price: new Prisma.Decimal('24'), imageUrls: [], attributes: {} },
  })
  await inventoryDb.sKU.create({
    data: { tenantId, code: 'OLD-1', name: 'Retired', category: 'Office', cost: new Prisma.Decimal('1'), price: new Prisma.Decimal('2'), isActive: false, imageUrls: [], attributes: {} },
  })
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId: sku.id, warehouseId: wh.id, batchId: '', quantityOnHand: 100, quantityAvailable: 100 },
  })
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await storefrontDb.b2BQuote.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: tenantId } })
  await authDb.tenant.deleteMany({ where: { id: tenantId } })
})

const line = (over: Record<string, unknown> = {}) => ({ lineNo: 1, skuCode, description: 'Pens', qty: 10, unitPrice: 20, ...over })

async function approvedQuote(token: string) {
  const created = await call(token, 'POST', '/quotes', { customerRef: customerId, lines: [line()] })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const id = created.body.id as string
  assert.equal((await call(token, 'POST', `/quotes/${id}/request-approval`)).status, 200)
  return id
}

test('a quote line needs a real, active product', async () => {
  const buyer = await login('STAFF', buyerEmail)
  const noSku = await call(buyer, 'POST', '/quotes', { customerRef: customerId, lines: [line({ skuCode: undefined })] })
  assert.equal(noSku.status, 400)
  assert.match(String(noSku.body.message), /Line 1: choose a product/)
  assert.equal((await call(buyer, 'POST', '/quotes', { customerRef: customerId, lines: [line({ skuCode: 'NOPE-9' })] })).status, 400)
  assert.equal((await call(buyer, 'POST', '/quotes', { customerRef: customerId, lines: [line({ skuCode: 'OLD-1' })] })).status, 400)
  assert.equal((await call(buyer, 'POST', '/quotes', { customerRef: customerId, lines: [line({ qty: 0 })] })).status, 400)
})

test('a quote that could not become an order cannot be approved', async () => {
  const manager = await login('MANAGER')
  // An older quote saved without a SKU (as Q-P3A2FCVH was).
  const q = await storefrontDb.b2BQuote.create({
    data: { tenantId, customerRef: customerId, status: 'PENDING_APPROVAL', lines: { create: [{ lineNo: 1, description: 'Item', qty: 1, unitPrice: 5 }] } },
  })
  const refused = await call(manager, 'POST', `/quotes/${q.id}/approve`)
  assert.equal(refused.status, 400)
  assert.match(String(refused.body.message), /can't be approved yet.*choose a product/)
})

test('the buyer places an approved quote at the negotiated price, not the list price', async () => {
  const buyer = await login('STAFF', buyerEmail)
  const manager = await login('MANAGER')
  const id = await approvedQuote(buyer)
  assert.equal((await call(manager, 'POST', `/quotes/${id}/approve`)).status, 200)

  const placed = await call(buyer, 'POST', `/quotes/${id}/submit`)
  assert.equal(placed.status, 200, JSON.stringify(placed.body))
  assert.equal(placed.body.status, 'SUBMITTED')
  const order = await orderDb.order.findUniqueOrThrow({ where: { id: placed.body.convertedOrderId as string }, include: { lineItems: true } })
  assert.equal(order.customerId, customerId)
  assert.equal(order.channel, 'B2B_PORTAL')
  assert.equal(Number(order.lineItems[0].unitPrice), 20, 'the approved $20, not the $24 list price')

  const again = await call(buyer, 'POST', `/quotes/${id}/submit`)
  assert.equal(again.body.convertedOrderId, placed.body.convertedOrderId, 'placing it twice makes one order')
  assert.equal(await orderDb.order.count({ where: { tenantId, id: placed.body.convertedOrderId as string } }), 1)
})

test('staff create the order for the customer; staff without order rights cannot', async () => {
  const buyer = await login('STAFF', buyerEmail)
  const manager = await login('MANAGER')
  const id = await approvedQuote(buyer)
  await call(manager, 'POST', `/quotes/${id}/approve`)

  const warehouse = await login('WAREHOUSE_STAFF')
  assert.equal((await call(warehouse, 'POST', `/quotes/${id}/submit`)).status, 403)

  const placed = await call(manager, 'POST', `/quotes/${id}/submit`)
  assert.equal(placed.status, 200, JSON.stringify(placed.body))
  const order = await orderDb.order.findUniqueOrThrow({ where: { id: placed.body.convertedOrderId as string }, include: { lineItems: true } })
  assert.equal(order.customerId, customerId, "the quote's customer, not the staff member")
  assert.equal(order.channel, 'SALES_REP')
  assert.equal(Number(order.lineItems[0].unitPrice), 20)
})

test('a quote that is not approved cannot be placed', async () => {
  const buyer = await login('STAFF', buyerEmail)
  const id = await approvedQuote(buyer)
  const res = await call(buyer, 'POST', `/quotes/${id}/submit`)
  assert.equal(res.status, 400)
  assert.equal((await storefrontDb.b2BQuote.findUniqueOrThrow({ where: { id } })).status, 'PENDING_APPROVAL')
})

test('accepting a counter-offer keeps each line’s product', async () => {
  const buyer = await login('STAFF', buyerEmail)
  const manager = await login('MANAGER')
  const created = await call(buyer, 'POST', '/quotes', { customerRef: customerId, lines: [line()] })
  const id = created.body.id as string
  const offer = await call(buyer, 'POST', `/quotes/${id}/counter-offers`, { offeredBy: 'BUYER', lines: [{ lineNo: 1, qty: 12, unitPrice: 19 }] })
  assert.equal((await call(manager, 'POST', `/quotes/${id}/counter-offers/accept`, { counterOfferId: offer.body.id })).status, 200)
  const q = await storefrontDb.b2BQuote.findUniqueOrThrow({ where: { id }, include: { lines: true } })
  assert.deepEqual([q.lines[0].skuCode, q.lines[0].description, q.lines[0].qty, Number(q.lines[0].unitPrice)], [skuCode, 'Pens', 12, 19])
})
