import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, dispatchDb, inventoryDb, orderDb, tenantDb } from './db'
import { updateTenantSalesTaxRate } from './tenant-tax'
import { updateTenantWorkflowSettings } from './tenant-workflow-settings'

const PASSWORD = 'van-sale-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
let whId = ''
let vanId = ''
let sku = ''
let okCustomer = ''
let unapproved = ''
let otherState = ''
let ctx: { routeId: string; stopId: string } = { routeId: '', stopId: '' }

async function makeUser(key: string, role: 'DRIVER' | 'MANAGER') {
  const email = `${key}-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role,
      permissions: [], emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  uid[key] = user.id
  tok[key] = (await loginUser(email, PASSWORD)).accessToken
}

const call = (key: string, method: string, path: string, body?: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${tok[key]}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )

/** A shipped order for `customerId` on a fresh route for driver `a`, to hang a van sale on. */
async function makeStop(customerId: string) {
  const order = await orderDb.order.create({
    data: { tenantId, customerId, channel: 'API', status: 'SHIPPED', paymentMethod: 'NET_TERMS', totalAmount: 10, taxAmount: 0 },
  })
  const route = await dispatchDb.deliveryRoute.create({
    data: {
      tenantId, driverId: uid.a, status: 'ASSIGNED', name: 'r',
      stops: { create: [{ sequence: 1, address: { orderId: order.id, customer: 'Acme', line1: '1 Main St' } }] },
    },
    include: { stops: true },
  })
  return { routeId: route.id, stopId: route.stops[0].id }
}

const sell = (key: string, c: typeof ctx, qty: number, paymentMethod = 'CASH') =>
  call(key, 'POST', `/routes/${c.routeId}/stops/${c.stopId}/van-sale`, { lines: [{ skuId: sku, quantity: qty }], paymentMethod })

const vanLevel = () => inventoryDb.stockLevel.findFirstOrThrow({ where: { tenantId, skuId: sku, warehouseId: vanId } })

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'S', slug: `s-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `s-${tenantId.slice(-8)}`, displayName: 'S', settings: {}, metadata: {} },
  })
  await updateTenantSalesTaxRate(tenantId, 0.1)
  await makeUser('a', 'DRIVER')
  await makeUser('b', 'DRIVER')
  await makeUser('m', 'MANAGER')
  const wh = await inventoryDb.warehouse.create({
    data: { tenantId, name: 'Main', code: `M-${randomUUID().slice(0, 4)}`, address: {}, isDefault: true },
  })
  whId = wh.id
  const s = await inventoryDb.sKU.create({
    data: { tenantId, code: `SK-${randomUUID().slice(0, 5)}`, name: 'Cases', price: 20, cost: 10, category: 'x', imageUrls: [], attributes: {} },
  })
  sku = s.id
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId: sku, warehouseId: whId, batchId: '', quantityOnHand: 20, quantityReserved: 0, quantityAvailable: 20 },
  })
  const van = await inventoryDb.warehouse.create({
    data: { tenantId, name: 'Van A', code: `V-${randomUUID().slice(0, 4)}`, address: {}, kind: 'VEHICLE', assignedDriverId: uid.a, stateCode: 'FL' },
  })
  vanId = van.id
  assert.equal((await call('m', 'POST', `/vans/${vanId}/load`, { fromWarehouseId: whId, lines: [{ skuId: sku, quantity: 10 }] })).status, 200)

  okCustomer = (await crmDb.customer.create({ data: { tenantId, name: 'Ok', primaryState: 'FL', vanSalesApproved: true } })).id
  unapproved = (await crmDb.customer.create({ data: { tenantId, name: 'No', primaryState: 'FL' } })).id
  otherState = (await crmDb.customer.create({ data: { tenantId, name: 'GA', primaryState: 'GA', vanSalesApproved: true } })).id
  // A contract price for the approved customer, below the catalog price of 20.
  await crmDb.customerPrice.create({ data: { tenantId, customerId: okCustomer, skuId: sku, unitPrice: 15 } })
  ctx = await makeStop(okCustomer)
})

after(async () => {
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await inventoryDb.vanManifest.deleteMany({ where: { tenantId } })
  await inventoryDb.stockReservation.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('an approved customer in the van\'s state buys at their own price, from the van, as a separate order', async () => {
  const res = await sell('a', ctx, 3)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { orderId: string }
  const order = await orderDb.order.findUniqueOrThrow({ where: { id: body.orderId }, include: { lineItems: true, invoice: true } })
  assert.equal(order.customerId, okCustomer)
  assert.equal(order.lineItems[0].warehouseId, vanId)
  assert.equal(Number(order.lineItems[0].unitPrice), 15)
  assert.equal(Number(order.totalAmount), 45 + Number(order.taxAmount ?? 0))
  assert.equal(Number(order.amountPaid), Number(order.totalAmount))
  assert.ok(order.invoice)
  assert.equal(Number(order.invoice!.totalAmount), Number(order.totalAmount))
  assert.equal((await vanLevel()).quantityOnHand, 7)
  const stop = await dispatchDb.routeStop.findUniqueOrThrow({ where: { id: ctx.stopId } })
  const sales = (stop.pod as { vanSales: Array<{ by: string; orderId: string; paymentMethod: string }> }).vanSales
  assert.equal(sales.length, 1)
  assert.equal(sales[0].by, uid.a)
  assert.equal(sales[0].orderId, body.orderId)
  assert.equal(sales[0].paymentMethod, 'CASH')
  // The order the customer signed for is untouched.
  const base = await orderDb.order.findFirstOrThrow({ where: { tenantId, customerId: okCustomer, channel: 'API' } })
  assert.equal(Number(base.totalAmount), 10)
})

test('refused for an unapproved account, another state, another driver\'s van, or a bad payment method', async () => {
  const noApproval = await makeStop(unapproved)
  const wrongState = await makeStop(otherState)
  assert.equal((await sell('a', noApproval, 1)).status, 409)
  assert.equal((await sell('a', wrongState, 1)).status, 409)
  assert.equal((await sell('b', ctx, 1)).status, 404)
  assert.equal((await sell('a', ctx, 1, 'CARD')).status, 400)
  assert.equal((await call('a', 'POST', `/routes/${ctx.routeId}/stops/${ctx.stopId}/van-sale`, { lines: [], paymentMethod: 'CASH' })).status, 400)
  assert.equal((await vanLevel()).quantityOnHand, 7)
})

test('the driver cannot name a price; the customer\'s price is used', async () => {
  const c = await makeStop(okCustomer)
  const res = await call('a', 'POST', `/routes/${c.routeId}/stops/${c.stopId}/van-sale`, {
    lines: [{ skuId: sku, quantity: 1, unitPrice: 0.01 }],
    paymentMethod: 'CASH',
  })
  assert.equal(res.status, 200)
  const order = await orderDb.order.findUniqueOrThrow({ where: { id: ((await res.json()) as { orderId: string }).orderId }, include: { lineItems: true } })
  assert.equal(Number(order.lineItems[0].unitPrice), 15)
})

test('more than the van holds is refused and leaves nothing behind', async () => {
  const c = await makeStop(okCustomer)
  const before = await orderDb.order.count({ where: { tenantId } })
  assert.equal((await sell('a', c, 50)).status, 409)
  assert.equal(await orderDb.order.count({ where: { tenantId } }), before)
})

test('above the tenant limit a driver is stopped and a manager can sell', async () => {
  await updateTenantWorkflowSettings(tenantId, { vanSaleThreshold: 20 })
  const c = await makeStop(okCustomer)
  assert.equal((await sell('a', c, 2)).status, 403)
  assert.equal((await sell('m', c, 2)).status, 200)
  await updateTenantWorkflowSettings(tenantId, { vanSaleThreshold: 0 })
})

test('two sales racing for the last units: no oversell', async () => {
  const left = (await vanLevel()).quantityAvailable
  const a = await makeStop(okCustomer)
  const b = await makeStop(okCustomer)
  const results = await Promise.all([sell('a', a, left), sell('a', b, left)])
  const statuses = results.map((r) => r.status).sort()
  assert.deepEqual(statuses, [200, 409])
  const level = await vanLevel()
  assert.equal(level.quantityOnHand, 0)
  assert.ok(level.quantityAvailable >= 0)
})

test('a stop that already has an outcome cannot take a van sale', async () => {
  const c = await makeStop(okCustomer)
  await dispatchDb.routeStop.update({ where: { id: c.stopId }, data: { status: 'FAILED' } })
  assert.equal((await sell('a', c, 1)).status, 409)
})
