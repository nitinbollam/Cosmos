import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, tenantDb } from './db'
import { listWarehouses } from './inventory'

const PASSWORD = 'van-stock-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
let whId = ''
let vanA = ''
let sku = ''

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

const level = (warehouseId: string) =>
  inventoryDb.stockLevel.findFirst({ where: { tenantId, skuId: sku, warehouseId, batchId: '' } })

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'V', slug: `v-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `v-${tenantId.slice(-8)}`, displayName: 'V', settings: {}, metadata: {} },
  })
  await makeUser('a', 'DRIVER')
  await makeUser('b', 'DRIVER')
  await makeUser('m', 'MANAGER')
  const wh = await inventoryDb.warehouse.create({
    data: { tenantId, name: 'Main', code: `MAIN-${randomUUID().slice(0, 4)}`, address: {}, isDefault: true },
  })
  whId = wh.id
  sku = `sku-${randomUUID()}`
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId: sku, warehouseId: whId, batchId: '', quantityOnHand: 10, quantityReserved: 0, quantityAvailable: 10 },
  })
  const res = await call('m', 'POST', '/vans', { name: 'Van A', code: `va-${randomUUID().slice(0, 4)}`, driverId: uid.a, stateCode: 'fl' })
  assert.equal(res.status, 201)
  vanA = ((await res.json()) as { id: string }).id
})

after(async () => {
  await inventoryDb.vanManifest.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('a van is stored as a vehicle in uppercase state and does not show up as a warehouse', async () => {
  const van = await inventoryDb.warehouse.findUniqueOrThrow({ where: { id: vanA } })
  assert.equal(van.kind, 'VEHICLE')
  assert.equal(van.stateCode, 'FL')
  assert.equal(van.assignedDriverId, uid.a)
  const list = await listWarehouses(tenantId)
  assert.deepEqual(list.map((w) => w.id), [whId])
  assert.equal((await listWarehouses(tenantId, { includeVehicles: true })).length, 2)
})

test('a driver can have only one van, and drivers cannot create or load vans', async () => {
  assert.equal((await call('m', 'POST', '/vans', { name: 'Dup', code: 'DUP', driverId: uid.a, stateCode: 'FL' })).status, 409)
  assert.equal((await call('m', 'POST', '/vans', { name: 'X', code: 'X', driverId: uid.b, stateCode: 'Florida' })).status, 400)
  assert.equal((await call('a', 'POST', '/vans', { name: 'Own', code: 'OWN', driverId: uid.a, stateCode: 'FL' })).status, 403)
  const load = { fromWarehouseId: whId, lines: [{ skuId: sku, quantity: 1 }] }
  assert.equal((await call('a', 'POST', `/vans/${vanA}/load`, load)).status, 403)
})

test('loading moves stock to the van, writes a manifest, and refuses more than the warehouse has', async () => {
  const ok = await call('m', 'POST', `/vans/${vanA}/load`, { fromWarehouseId: whId, lines: [{ skuId: sku, quantity: 6 }], note: 'Monday' })
  assert.equal(ok.status, 200)
  assert.equal((await level(whId))!.quantityOnHand, 4)
  assert.equal((await level(vanA))!.quantityOnHand, 6)
  const manifests = await inventoryDb.vanManifest.findMany({ where: { tenantId, vanId: vanA } })
  assert.equal(manifests.length, 1)
  assert.equal(manifests[0].createdBy, uid.m)
  assert.equal(manifests[0].kind, 'LOAD')

  const tooMuch = await call('m', 'POST', `/vans/${vanA}/load`, { fromWarehouseId: whId, lines: [{ skuId: sku, quantity: 5 }] })
  assert.equal(tooMuch.status, 409)
  assert.equal((await level(whId))!.quantityOnHand, 4)
  assert.equal((await inventoryDb.vanManifest.count({ where: { tenantId, vanId: vanA } })), 1)
})

test('the driver sees their own van\'s stock and nobody else\'s', async () => {
  const mine = await call('a', 'GET', `/vans/${vanA}`)
  assert.equal(mine.status, 200)
  const body = (await mine.json()) as { items: Array<{ skuId: string; onHand: number }> }
  assert.deepEqual(body.items.map((i) => [i.skuId, i.onHand]), [[sku, 6]])
  assert.equal((await call('b', 'GET', `/vans/${vanA}`)).status, 404)
  assert.deepEqual(await (await call('b', 'GET', '/vans')).json(), [])
  assert.equal((await (await call('a', 'GET', '/vans')).json() as unknown[]).length, 1)
})

test('two loads racing for the last units cannot both win', async () => {
  const body = { fromWarehouseId: whId, lines: [{ skuId: sku, quantity: 3 }] }
  const results = await Promise.all([call('m', 'POST', `/vans/${vanA}/load`, body), call('m', 'POST', `/vans/${vanA}/load`, body)])
  const statuses = results.map((r) => r.status).sort()
  assert.deepEqual(statuses, [200, 409])
  assert.equal((await level(whId))!.quantityOnHand, 1)
  assert.equal((await level(vanA))!.quantityOnHand, 9)
})

test('unloading puts stock back, and only into a real warehouse', async () => {
  assert.equal((await call('m', 'POST', `/vans/${vanA}/unload`, { toWarehouseId: vanA, lines: [{ skuId: sku, quantity: 1 }] })).status, 400)
  assert.equal((await call('m', 'POST', `/vans/${vanA}/unload`, { toWarehouseId: whId, lines: [{ skuId: sku, quantity: 100 }] })).status, 409)
  assert.equal((await call('m', 'POST', `/vans/${vanA}/unload`, { toWarehouseId: whId, lines: [{ skuId: sku, quantity: 4 }] })).status, 200)
  assert.equal((await level(whId))!.quantityOnHand, 5)
  assert.equal((await level(vanA))!.quantityOnHand, 5)
})

test('a manager approves an account for van sales; a driver cannot', async () => {
  const c = await crmDb.customer.create({ data: { tenantId, name: 'Acme', primaryState: 'FL' } })
  assert.equal((await call('a', 'PUT', `/vans/customers/${c.id}/van-sales`, { approved: true })).status, 403)
  assert.equal((await call('m', 'PUT', `/vans/customers/${c.id}/van-sales`, { approved: 'yes' })).status, 400)
  assert.equal((await call('m', 'PUT', `/vans/customers/${c.id}/van-sales`, { approved: true })).status, 200)
  assert.equal((await crmDb.customer.findUniqueOrThrow({ where: { id: c.id } })).vanSalesApproved, true)
  assert.equal((await call('m', 'PUT', '/vans/customers/missing/van-sales', { approved: true })).status, 404)
})
