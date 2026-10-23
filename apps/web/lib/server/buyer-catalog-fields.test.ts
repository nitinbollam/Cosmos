import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, inventoryDb, tenantDb } from './db'

const PASSWORD = 'catalog-fields-pass-1'
const tenantId = `t-${randomUUID()}`
const buyerEmail = `buyer-${randomUUID().slice(0, 6)}@example.test`
const userIds: string[] = []
let skuId = ''

/** Fields that let a buyer work out the distributor's margin or internal stock. */
const INTERNAL = ['cost', 'minPrice', 'quantityOnHand', 'quantityReserved', 'reorderPoint', 'reorderQty', 'tenantId']

async function login(role: 'STAFF' | 'MANAGER', email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`) {
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

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'Cat', slug: `cat-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `cat-${tenantId.slice(-8)}`, displayName: 'Cat', settings: {}, metadata: {} },
  })
  const customer = await crmDb.customer.create({ data: { tenantId, name: 'Buyer Co', email: buyerEmail } })
  const wh = await inventoryDb.warehouse.create({ data: { tenantId, name: 'Main', code: 'MAIN', address: {} } })
  const sku = await inventoryDb.sKU.create({
    data: {
      tenantId,
      code: 'PEN-100',
      name: 'Office Pen Pack',
      category: 'Office',
      cost: new Prisma.Decimal('9'),
      price: new Prisma.Decimal('24'),
      minPrice: new Prisma.Decimal('20'),
      imageUrls: [],
      attributes: {},
    },
  })
  skuId = sku.id
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId, warehouseId: wh.id, quantityOnHand: 40, quantityReserved: 5, quantityAvailable: 35, reorderPoint: 10, reorderQty: 50 },
  })
  // A contract price for this buyer, so the detail route must apply it too.
  await crmDb.customerPrice.create({ data: { tenantId, customerId: customer.id, skuId, unitPrice: 21 } })
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await crmDb.customerPrice.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: tenantId } })
  await authDb.tenant.deleteMany({ where: { id: tenantId } })
})

async function get(token: string, path: string) {
  const res = await handleApiRequest(new Request(`http://localhost/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } }))
  assert.equal(res.status, 200, `${path} → ${res.status}`)
  return (await res.json()) as Record<string, unknown>
}

const leaked = (row: Record<string, unknown>) => INTERNAL.filter((k) => k in row)
let buyerToken: Promise<string> | undefined
const buyer = () => (buyerToken ??= login('STAFF', buyerEmail))

test('the buyer catalog list carries the buyer price and availability, but no cost, minimum price or internal stock', async () => {
  const list = await get(await buyer(), '/skus')
  const [row] = list.items as Record<string, unknown>[]
  assert.deepEqual(leaked(row), [])
  assert.equal(row.code, 'PEN-100')
  assert.equal(Number(row.price), 21)
  assert.equal(row.priceSource, 'contract')
  assert.equal(row.quantityAvailable, 35)
})

test('the buyer product detail is filtered the same way and shows their contract price', async () => {
  const row = await get(await buyer(), `/skus/${skuId}`)
  assert.deepEqual(leaked(row), [])
  assert.equal(row.name, 'Office Pen Pack')
  assert.equal(Number(row.price), 21)
})

test('staff still see cost and stock figures', async () => {
  const manager = await login('MANAGER')
  const [row] = (await get(manager, '/skus')).items as Record<string, unknown>[]
  assert.equal(Number(row.cost), 9)
  assert.equal(row.quantityOnHand, 40)
  assert.equal(Number((await get(manager, `/skus/${skuId}`)).minPrice), 20)
})
