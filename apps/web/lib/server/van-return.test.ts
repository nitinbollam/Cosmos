import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, dispatchDb, inventoryDb, tenantDb } from './db'

const PASSWORD = 'van-return-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
let whId = ''
let n = 0

async function makeUser(key: string, role: 'DRIVER' | 'MANAGER' | 'WAREHOUSE_STAFF') {
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

/** A fresh driver with a van holding `qty` of a fresh item, loaded by the manager. */
async function newVan(qty: number) {
  n += 1
  const d = `d${n}`
  await makeUser(d, 'DRIVER')
  const sku = await inventoryDb.sKU.create({
    data: { tenantId, code: `SK${n}`, name: `Item ${n}`, category: 'x', cost: 5, price: 10, imageUrls: [], attributes: {} },
  })
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId: sku.id, warehouseId: whId, batchId: '', quantityOnHand: 100, quantityReserved: 0, quantityAvailable: 100 },
  })
  const van = await inventoryDb.warehouse.create({
    data: { tenantId, name: `Van ${n}`, code: `V${n}-${randomUUID().slice(0, 3)}`, address: {}, kind: 'VEHICLE', assignedDriverId: uid[d], stateCode: 'FL' },
  })
  assert.equal((await call('m', 'POST', `/vans/${van.id}/load`, { fromWarehouseId: whId, lines: [{ skuId: sku.id, quantity: qty }] })).status, 200)
  return { d, vanId: van.id, skuId: sku.id }
}

const level = async (skuId: string, warehouseId: string) =>
  (await inventoryDb.stockLevel.findFirst({ where: { tenantId, skuId, warehouseId, batchId: '' } }))?.quantityOnHand ?? 0

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'R', slug: `r-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `r-${tenantId.slice(-8)}`, displayName: 'R', settings: {}, metadata: {} },
  })
  await makeUser('m', 'MANAGER')
  await makeUser('w', 'WAREHOUSE_STAFF')
  whId = (await inventoryDb.warehouse.create({
    data: { tenantId, name: 'Main', code: `M-${randomUUID().slice(0, 4)}`, address: {}, isDefault: true },
  })).id
})

after(async () => {
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await inventoryDb.vanReturn.deleteMany({ where: { tenantId } })
  await inventoryDb.vanManifest.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('a clean day: count matches, picker splits good and damaged, stock goes back, the return closes', async () => {
  const v = await newVan(10)
  const made = await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [{ skuId: v.skuId, quantity: 10 }], cashCounted: 0 })
  assert.equal(made.status, 201)
  const id = ((await made.json()) as { id: string }).id
  const before = await level(v.skuId, whId)
  const res = await call('w', 'POST', `/vans/returns/${id}/inspect`, { toWarehouseId: whId, lines: [{ skuId: v.skuId, good: 8, damaged: 2 }] })
  assert.equal(res.status, 200)
  assert.equal(((await res.json()) as { status: string }).status, 'CLOSED')
  assert.equal(await level(v.skuId, v.vanId), 0)
  assert.equal(await level(v.skuId, whId), before + 8)
  const row = await inventoryDb.vanReturn.findUniqueOrThrow({ where: { id } })
  assert.equal(row.inspectedBy, uid.w)
  assert.ok(row.closedAt)
  const dmg = await inventoryDb.stockLedgerEntry.findMany({ where: { tenantId, skuId: v.skuId, referenceType: 'VAN_RETURN' } })
  assert.equal(dmg.length, 1)
  assert.equal(dmg[0].quantityDelta, -2)
})

test('who may do what, and one return at a time', async () => {
  const v = await newVan(5)
  const other = await newVan(5)
  const body = { counts: [{ skuId: v.skuId, quantity: 5 }], cashCounted: 0 }
  assert.equal((await call(other.d, 'POST', `/vans/${v.vanId}/returns`, body)).status, 404)
  assert.equal((await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [{ skuId: v.skuId, quantity: -1 }], cashCounted: 0 })).status, 400)
  assert.equal((await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [], cashCounted: 'x' })).status, 400)
  const made = await call(v.d, 'POST', `/vans/${v.vanId}/returns`, body)
  assert.equal(made.status, 201)
  const id = ((await made.json()) as { id: string }).id
  assert.equal((await call(v.d, 'POST', `/vans/${v.vanId}/returns`, body)).status, 409)
  const insp = { toWarehouseId: whId, lines: [{ skuId: v.skuId, good: 5, damaged: 0 }] }
  assert.equal((await call(v.d, 'POST', `/vans/returns/${id}/inspect`, insp)).status, 403)
  assert.equal((await call('w', 'POST', `/vans/returns/${id}/inspect`, { ...insp, lines: [{ skuId: v.skuId, good: 4, damaged: 0 }] })).status, 400)
  assert.equal((await call('w', 'POST', `/vans/returns/${id}/inspect`, { ...insp, toWarehouseId: v.vanId })).status, 400)
  assert.equal(await level(v.skuId, v.vanId), 5)
  assert.equal((await call('w', 'POST', `/vans/returns/${id}/inspect`, insp)).status, 200)
  assert.equal((await call('w', 'POST', `/vans/returns/${id}/inspect`, insp)).status, 409)
})

test('a shortage stays on the van until a manager signs it off with a note', async () => {
  const v = await newVan(10)
  const made = await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [{ skuId: v.skuId, quantity: 7 }], cashCounted: 0 })
  const id = ((await made.json()) as { id: string }).id
  const insp = await call('w', 'POST', `/vans/returns/${id}/inspect`, { toWarehouseId: whId, lines: [{ skuId: v.skuId, good: 7, damaged: 0 }] })
  const body = (await insp.json()) as { status: string; outstanding: { lines: string[] } }
  assert.equal(body.status, 'INSPECTED')
  assert.deepEqual(body.outstanding.lines, [v.skuId])
  assert.equal(await level(v.skuId, v.vanId), 3)

  assert.equal((await call('w', 'POST', `/vans/returns/${id}/resolve`, { note: 'lost', lines: [v.skuId] })).status, 403)
  assert.equal((await call('m', 'POST', `/vans/returns/${id}/resolve`, { lines: [v.skuId] })).status, 400)
  const done = await call('m', 'POST', `/vans/returns/${id}/resolve`, { note: 'Spilled, driver report filed', lines: [v.skuId] })
  assert.equal(done.status, 200)
  assert.equal(((await done.json()) as { status: string }).status, 'CLOSED')
  assert.equal(await level(v.skuId, v.vanId), 0)
  const row = await inventoryDb.vanReturn.findUniqueOrThrow({ where: { id } })
  const r = row.resolution as { lines: Record<string, { action: string; quantity: number; by: string }> }
  assert.equal(r.lines[v.skuId].action, 'WRITE_OFF')
  assert.equal(r.lines[v.skuId].quantity, 3)
  assert.equal(r.lines[v.skuId].by, uid.m)
})

test('counting more than the system expects must be signed off before the stock is moved', async () => {
  const v = await newVan(10)
  const made = await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [{ skuId: v.skuId, quantity: 12 }], cashCounted: 0 })
  const id = ((await made.json()) as { id: string }).id
  const insp = { toWarehouseId: whId, lines: [{ skuId: v.skuId, good: 12, damaged: 0 }] }
  assert.equal((await call('w', 'POST', `/vans/returns/${id}/inspect`, insp)).status, 409)
  assert.equal(await level(v.skuId, v.vanId), 10)
  assert.equal((await call('m', 'POST', `/vans/returns/${id}/resolve`, { note: 'Unrecorded load found', lines: [v.skuId] })).status, 200)
  assert.equal(await level(v.skuId, v.vanId), 12)
  const res = await call('w', 'POST', `/vans/returns/${id}/inspect`, insp)
  assert.equal(((await res.json()) as { status: string }).status, 'CLOSED')
  assert.equal(await level(v.skuId, v.vanId), 0)
})

test('cash and cheques taken on the road are compared with the count, and a difference needs sign-off', async () => {
  const v = await newVan(4)
  const route = await dispatchDb.deliveryRoute.create({
    data: {
      tenantId, driverId: uid[v.d], status: 'IN_PROGRESS', name: 'r',
      stops: {
        create: [{
          sequence: 1,
          address: { customer: 'Acme' },
          pod: {
            vanSales: [
              { at: new Date().toISOString(), by: uid[v.d], orderId: 'o1', total: '30.00', paymentMethod: 'CASH', lines: [] },
              { at: new Date().toISOString(), by: uid[v.d], orderId: 'o2', total: '15.50', paymentMethod: 'CHECK', lines: [] },
              { at: new Date().toISOString(), by: uid[v.d], orderId: 'o3', total: '99.00', paymentMethod: 'NET_TERMS', lines: [] },
            ],
          },
        }],
      },
    },
  })
  assert.ok(route.id)
  const made = await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [{ skuId: v.skuId, quantity: 4 }], cashCounted: 40 })
  const row = (await made.json()) as { id: string; cash: { expectedCents: number; countedCents: number } }
  assert.deepEqual(row.cash, { expectedCents: 4550, countedCents: 4000 })
  const insp = await call('w', 'POST', `/vans/returns/${row.id}/inspect`, { toWarehouseId: whId, lines: [{ skuId: v.skuId, good: 4, damaged: 0 }] })
  const body = (await insp.json()) as { status: string; outstanding: { cash: boolean } }
  assert.equal(body.status, 'INSPECTED')
  assert.equal(body.outstanding.cash, true)
  const done = await call('m', 'POST', `/vans/returns/${row.id}/resolve`, { note: 'Short $5.50, deducted from pay', cash: true })
  assert.equal(((await done.json()) as { status: string }).status, 'CLOSED')
})

test('the next day starts fresh: yesterday\'s road sales are not counted again', async () => {
  const v = await newVan(2)
  const first = await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [{ skuId: v.skuId, quantity: 2 }], cashCounted: 0 })
  const id = ((await first.json()) as { id: string }).id
  await call('w', 'POST', `/vans/returns/${id}/inspect`, { toWarehouseId: whId, lines: [{ skuId: v.skuId, good: 2, damaged: 0 }] })
  assert.equal((await call('m', 'POST', `/vans/${v.vanId}/load`, { fromWarehouseId: whId, lines: [{ skuId: v.skuId, quantity: 2 }] })).status, 200)
  const second = await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [{ skuId: v.skuId, quantity: 2 }], cashCounted: 0 })
  assert.equal(second.status, 201)
  assert.deepEqual(((await second.json()) as { cash: unknown }).cash, { expectedCents: 0, countedCents: 0 })
})
