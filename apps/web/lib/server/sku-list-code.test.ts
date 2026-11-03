import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, inventoryDb, tenantDb } from './db'

// ClickUp 52: a scanned SKU must show however many other codes contain its code.

const PASSWORD = 'sku-list-code-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
let token = ''
const CODE = `S52${randomUUID().slice(0, 6)}`

type ListRow = { code: string; quantityOnHand: number; quantityAvailable: number }
type ListPage = { items: ListRow[]; total: number }

const list = async (query: string): Promise<ListPage> => {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1/skus?${query}`, { headers: { authorization: `Bearer ${token}` } }),
  )
  assert.equal(res.status, 200)
  return (await res.json()) as ListPage
}

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'A', slug: `a-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `a-${tenantId.slice(-8)}`, displayName: 'A', settings: {}, metadata: {} },
  })
  const email = `inv-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: 'Inv', lastName: 'U', role: 'MANAGER', permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  token = (await loginUser(email, PASSWORD)).accessToken

  const sku = (code: string, name: string) => ({
    tenantId, code, name, category: 'TEST', cost: 1, price: 2, imageUrls: [], attributes: {},
  })
  // 55 codes that contain CODE and sort ahead of it by name, so a plain search pushes it past page 1.
  await inventoryDb.sKU.createMany({
    data: Array.from({ length: 55 }, (_, i) => sku(`${CODE}-${String(i).padStart(2, '0')}`, `Aa similar ${i}`)),
  })
  const exact = await inventoryDb.sKU.create({ data: sku(CODE, 'Zz the scanned one') })
  await inventoryDb.stockLevel.createMany({
    data: [
      { tenantId, skuId: exact.id, warehouseId: 'w1', quantityOnHand: 7, quantityAvailable: 7 },
      { tenantId, skuId: exact.id, warehouseId: 'w2', quantityOnHand: 5, quantityAvailable: 4, quantityReserved: 1 },
    ],
  })
})

after(async () => {
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('a plain search can push the exact code off page 1', async () => {
  const page1 = await list(`search=${CODE}&page=1&pageSize=50`)
  assert.equal(page1.total, 56)
  assert.equal(page1.items.length, 50)
  assert.ok(!page1.items.some((s) => s.code === CODE))
})

test('code= returns only the exact SKU, with its stock across warehouses', async () => {
  const res = await list(`code=${CODE}&page=1&pageSize=50`)
  assert.equal(res.total, 1)
  assert.deepEqual(
    res.items.map((s) => [s.code, s.quantityOnHand, s.quantityAvailable]),
    [[CODE, 12, 11]],
  )
})

test('code= with a warehouse gives that warehouse’s stock', async () => {
  const res = await list(`code=${CODE}&warehouseId=w1`)
  assert.deepEqual(res.items.map((s) => [s.code, s.quantityOnHand]), [[CODE, 7]])
})

test('code= matches exactly: a code that only contains it, or a made-up one, is not returned', async () => {
  assert.equal((await list(`code=${CODE.slice(0, -1)}`)).total, 0)
  assert.equal((await list(`code=${CODE}-00`)).items[0]?.code, `${CODE}-00`)
  assert.equal((await list('code=NO-SUCH-CODE')).total, 0)
})
