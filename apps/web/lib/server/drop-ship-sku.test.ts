import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, orderDb, purchasingDb, tenantDb } from './db'
import { createOrder } from './orders'

const PASSWORD = 'drop-ship-sku-pass-1'
const tenantId = `t-${randomUUID()}`
const buyerEmail = `buyer-${randomUUID().slice(0, 6)}@example.test`
const userIds: string[] = []
let customerId = ''
let warehouseId = ''
let supplierId = ''
let dropSkuId = ''
let stockSkuId = ''

async function login(role: 'STAFF' | 'MANAGER' | 'WAREHOUSE_STAFF', email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`) {
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: role,
      lastName: 'U',
      role,
      permissions: [],
      emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  return (await loginUser(email, PASSWORD)).accessToken
}

const sku = (code: string, price: string) =>
  inventoryDb.sKU.create({
    data: { tenantId, code, name: code, category: 'Office', cost: new Prisma.Decimal('5'), price: new Prisma.Decimal(price), imageUrls: [], attributes: {} },
  })

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'DS', slug: `ds-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `ds-${tenantId.slice(-8)}`, displayName: 'DS', settings: { salesTaxRate: 0, salesTaxConfirmedAt: new Date().toISOString() }, metadata: {} },
  })
  customerId = (await crmDb.customer.create({ data: { tenantId, name: 'Buyer Co', email: buyerEmail } })).id
  warehouseId = (await inventoryDb.warehouse.create({ data: { tenantId, name: 'Main', code: 'MAIN', address: {} } })).id
  supplierId = (await purchasingDb.supplier.create({ data: { tenantId, code: 'ACME', name: 'Acme Supply' } })).id
  dropSkuId = (await sku('DESK-1', '200')).id
  stockSkuId = (await sku('PEN-1', '4')).id
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId: stockSkuId, warehouseId, quantityOnHand: 50, quantityReserved: 0, quantityAvailable: 50 },
  })
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await orderDb.orderLineItem.deleteMany({ where: { order: { tenantId } } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await purchasingDb.purchaseOrder.deleteMany({ where: { tenantId } })
  await purchasingDb.supplier.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: tenantId } })
  await authDb.tenant.deleteMany({ where: { id: tenantId } })
})

async function call(token: string, method: string, path: string, body?: unknown) {
  return handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

let managerToken: Promise<string> | undefined
const manager = () => (managerToken ??= login('MANAGER'))
let buyerToken: Promise<string> | undefined
const buyer = () => (buyerToken ??= login('STAFF', buyerEmail))

const line = (skuId: string, quantity: number, unitPrice: number) => ({ skuId, warehouseId, quantity, unitPrice })

test('a manager sets a drop-ship supplier on the SKU page; an unknown supplier is refused', async () => {
  const bad = await call(await manager(), 'PATCH', `/skus/${dropSkuId}`, { dropShipSupplierId: 'not-a-supplier' })
  assert.equal(bad.status, 400)

  const ok = await call(await manager(), 'PATCH', `/skus/${dropSkuId}`, { dropShipSupplierId: supplierId })
  assert.equal(ok.status, 200)
  assert.equal(((await ok.json()) as { dropShipSupplierId: string }).dropShipSupplierId, supplierId)
})

test('warehouse staff can edit products but not choose or clear a drop-ship supplier: that is a purchasing decision', async () => {
  const warehouse = await login('WAREHOUSE_STAFF')
  const set = await call(warehouse, 'PATCH', `/skus/${stockSkuId}`, { dropShipSupplierId: supplierId })
  assert.equal(set.status, 403)
  assert.equal(
    (await call(warehouse, 'PATCH', `/skus/${dropSkuId}`, { dropShipSupplierId: null })).status,
    403,
    'clearing it is refused too',
  )
  const create = await call(warehouse, 'POST', '/skus', { code: 'NEW-1', name: 'New', category: 'Office', cost: 1, price: 2, dropShipSupplierId: supplierId })
  assert.equal(create.status, 403)
  const imported = await call(warehouse, 'POST', '/skus/import', {
    rows: [{ code: 'IMP-1', name: 'Imp', category: 'Office', cost: 1, price: 2, dropShipSupplierId: supplierId }],
  })
  assert.equal(imported.status, 403)

  // Ordinary product edits still work, and nothing changed.
  assert.equal((await call(warehouse, 'PATCH', `/skus/${stockSkuId}`, { name: 'PEN-1' })).status, 200)
  const [pen, desk] = await Promise.all([
    inventoryDb.sKU.findFirstOrThrow({ where: { id: stockSkuId } }),
    inventoryDb.sKU.findFirstOrThrow({ where: { id: dropSkuId } }),
  ])
  assert.equal(pen.dropShipSupplierId, null)
  assert.equal(desk.dropShipSupplierId, supplierId)
  assert.equal(await inventoryDb.sKU.count({ where: { tenantId, code: { in: ['NEW-1', 'IMP-1'] } } }), 0)
})

test('buyers see that a product ships from the supplier, but not which supplier, and it is orderable without stock', async () => {
  const res = await call(await buyer(), 'GET', '/skus?inStockOnly=true')
  assert.equal(res.status, 200)
  const items = ((await res.json()) as { items: Record<string, unknown>[] }).items
  const desk = items.find((i) => i.id === dropSkuId)
  assert.ok(desk, 'drop-ship SKU listed under in-stock only')
  assert.equal(desk.dropShip, true)
  assert.equal('dropShipSupplierId' in desk, false)
  assert.equal(items.find((i) => i.id === stockSkuId)?.dropShip, false)
})

test('a checkout order drop-ships the supplier product and ignores fulfilment fields sent by the buyer', async () => {
  const res = await call(await buyer(), 'POST', '/orders', {
    customerId,
    channel: 'B2B_PORTAL',
    paymentMethod: 'CARD',
    lineItems: [
      line(dropSkuId, 1, 200),
      // A buyer trying to raise a supplier PO for a stock product.
      { ...line(stockSkuId, 2, 4), fulfillmentType: 'DROP_SHIP', supplierId },
    ],
  })
  assert.equal(res.status, 201, await res.clone().text())
  const { id } = (await res.json()) as { id: string }
  const lines = await orderDb.orderLineItem.findMany({ where: { orderId: id } })
  const bySku = new Map(lines.map((l) => [l.skuId, l]))
  assert.equal(bySku.get(dropSkuId)?.fulfillmentType, 'DROP_SHIP')
  assert.equal(bySku.get(dropSkuId)?.supplierId, supplierId)
  assert.equal(bySku.get(stockSkuId)?.fulfillmentType, 'STOCK')
  assert.equal(bySku.get(stockSkuId)?.supplierId, null)
})

test('placing the order raises a purchase order to the supplier for the drop-ship line', async () => {
  const order = await createOrder(
    tenantId,
    { customerId, channel: 'API', paymentMethod: 'NET_TERMS', lineItems: [line(dropSkuId, 3, 200)] },
    { awaitPipeline: true },
  )
  const [dropLine] = await orderDb.orderLineItem.findMany({ where: { orderId: order.id } })
  assert.ok(dropLine.dropShipPoId, 'line linked to a PO')
  const po = await purchasingDb.purchaseOrder.findFirstOrThrow({ where: { id: dropLine.dropShipPoId!, tenantId } })
  assert.equal(po.supplierId, supplierId)
})

test('counter and van sales hand the goods over, so they never drop-ship', async () => {
  const order = await createOrder(
    tenantId,
    { customerId, channel: 'POS', paymentMethod: 'CASH', lineItems: [line(dropSkuId, 1, 200)] },
    { stockInHand: true, skipPriceValidation: true, awaitPipeline: true },
  )
  const [posLine] = await orderDb.orderLineItem.findMany({ where: { orderId: order.id } })
  assert.equal(posLine.fulfillmentType, 'STOCK')
  assert.equal(posLine.supplierId, null)
})

test('clearing the supplier turns drop-ship off', async () => {
  const res = await call(await manager(), 'PATCH', `/skus/${dropSkuId}`, { dropShipSupplierId: '' })
  assert.equal(res.status, 200)
  assert.equal((await inventoryDb.sKU.findFirstOrThrow({ where: { id: dropSkuId } })).dropShipSupplierId, null)
})
