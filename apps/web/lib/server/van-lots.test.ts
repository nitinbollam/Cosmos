import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, dispatchDb, inventoryDb, tenantDb } from './db'

const PASSWORD = 'van-lots-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tok: Record<string, string> = {}
const uid: Record<string, string> = {}
let whId = ''
let n = 0

async function makeUser(key: string, role: 'DRIVER' | 'MANAGER' | 'WAREHOUSE_STAFF') {
  const email = `${key}-${randomUUID().slice(0, 6)}@example.test`
  const u = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: key, lastName: 'U', role, permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(u.id)
  uid[key] = u.id
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

const onHand = async (skuId: string, warehouseId: string) => {
  const rows = await inventoryDb.stockLevel.findMany({ where: { tenantId, skuId, warehouseId } })
  return Object.fromEntries(rows.filter((r) => r.quantityOnHand > 0).map((r) => [r.batchId, r.quantityOnHand]))
}

/** A lot-tracked item held in the warehouse as two lots, and a van for a fresh driver. */
async function setup() {
  n += 1
  const d = `d${n}`
  await makeUser(d, 'DRIVER')
  const sku = await inventoryDb.sKU.create({
    data: { tenantId, code: `LT${n}`, name: `Lot ${n}`, category: 'x', cost: 5, price: 10, imageUrls: [], attributes: {}, trackLot: true },
  })
  for (const [code, qty, expiry] of [['LATE', 10, '2027-09-01'], ['SOON', 6, '2027-02-01']] as const) {
    await inventoryDb.inventoryLot.create({ data: { tenantId, skuId: sku.id, warehouseId: whId, batchCode: code, expiryDate: new Date(expiry) } })
    await inventoryDb.stockLevel.create({
      data: { tenantId, skuId: sku.id, warehouseId: whId, batchId: code, quantityOnHand: qty, quantityReserved: 0, quantityAvailable: qty, expiryDate: new Date(expiry) },
    })
  }
  const van = await inventoryDb.warehouse.create({
    data: { tenantId, name: `Van ${n}`, code: `V${n}-${randomUUID().slice(0, 3)}`, address: {}, kind: 'VEHICLE', assignedDriverId: uid[d], stateCode: 'FL' },
  })
  return { d, skuId: sku.id, vanId: van.id }
}

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'L', slug: `l-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({ data: { id: tenantId, slug: `l-${tenantId.slice(-8)}`, displayName: 'L', settings: {}, metadata: {} } })
  await makeUser('m', 'MANAGER')
  await makeUser('w', 'WAREHOUSE_STAFF')
  whId = (await inventoryDb.warehouse.create({ data: { tenantId, name: 'Main', code: `M-${randomUUID().slice(0, 4)}`, address: {}, isDefault: true } })).id
})

after(async () => {
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await inventoryDb.vanReturn.deleteMany({ where: { tenantId } })
  await inventoryDb.vanManifest.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.inventoryLot.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('loading takes the lot that expires first, keeps the lot on the van, and writes it on the manifest', async () => {
  const v = await setup()
  const res = await call('m', 'POST', `/vans/${v.vanId}/load`, { fromWarehouseId: whId, lines: [{ skuId: v.skuId, quantity: 9 }] })
  assert.equal(res.status, 200)
  assert.deepEqual(await onHand(v.skuId, v.vanId), { SOON: 6, LATE: 3 })
  assert.deepEqual(await onHand(v.skuId, whId), { LATE: 7 })
  const manifest = await inventoryDb.vanManifest.findFirstOrThrow({ where: { tenantId, vanId: v.vanId } })
  const line = (manifest.lines as Array<{ batches?: Array<{ batchId: string; quantity: number }> }>)[0]
  assert.deepEqual(line.batches, [{ batchId: 'SOON', quantity: 6 }, { batchId: 'LATE', quantity: 3 }])
})

test('a return brings each lot back to the warehouse, and damaged units come off a real lot', async () => {
  const v = await setup()
  await call('m', 'POST', `/vans/${v.vanId}/load`, { fromWarehouseId: whId, lines: [{ skuId: v.skuId, quantity: 9 }] })
  const made = await call(v.d, 'POST', `/vans/${v.vanId}/returns`, { counts: [{ skuId: v.skuId, quantity: 9 }], cashCounted: 0 })
  assert.equal(made.status, 201)
  const id = ((await made.json()) as { id: string }).id
  const res = await call('w', 'POST', `/vans/returns/${id}/inspect`, { toWarehouseId: whId, lines: [{ skuId: v.skuId, good: 7, damaged: 2 }] })
  assert.equal(res.status, 200)
  assert.deepEqual(await onHand(v.skuId, v.vanId), {})
  // 6 SOON + 3 LATE came back; the 2 damaged units were the first two of SOON.
  assert.deepEqual(await onHand(v.skuId, whId), { SOON: 4, LATE: 10 })
})

test('a lot-tracked item the warehouse cannot cover is refused and nothing moves', async () => {
  const v = await setup()
  const res = await call('m', 'POST', `/vans/${v.vanId}/load`, { fromWarehouseId: whId, lines: [{ skuId: v.skuId, quantity: 99 }] })
  assert.equal(res.status, 409)
  assert.deepEqual(await onHand(v.skuId, whId), { LATE: 10, SOON: 6 })
})
