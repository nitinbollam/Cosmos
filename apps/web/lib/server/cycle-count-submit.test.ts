import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-inventory'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, inventoryDb, tenantDb, wmsDb } from './db'

const PASSWORD = 'cycle-count-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
let warehouseId = ''
let token = ''

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'Cnt', slug: `cnt-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `cnt-${tenantId.slice(-8)}`, displayName: 'Cnt', settings: {}, metadata: {} },
  })
  const email = `manager-${randomUUID().slice(0, 6)}@example.test`
  const user = await authDb.user.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: 'M', lastName: 'U', role: 'MANAGER', permissions: [], emailVerifiedAt: new Date() },
  })
  userIds.push(user.id)
  token = (await loginUser(email, PASSWORD)).accessToken

  const wh = await inventoryDb.warehouse.create({ data: { tenantId, name: 'Main', code: 'MAIN', address: {} } })
  warehouseId = wh.id
  const bin = await inventoryDb.binLocation.create({ data: { tenantId, warehouseId, code: 'A-01-03' } })
  const sku = await inventoryDb.sKU.create({
    data: { tenantId, code: 'PEN-100', name: 'Office Pen Pack', category: 'Office', cost: new Prisma.Decimal(9), price: new Prisma.Decimal(24), imageUrls: [], attributes: {} },
  })
  await inventoryDb.stockLevel.create({
    data: { tenantId, skuId: sku.id, warehouseId, locationId: bin.id, quantityOnHand: 12, quantityAvailable: 12 },
  })
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await wmsDb.cycleCount.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLevel.deleteMany({ where: { tenantId } })
  await inventoryDb.sKU.deleteMany({ where: { tenantId } })
  await inventoryDb.binLocation.deleteMany({ where: { tenantId } })
  await inventoryDb.warehouse.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: tenantId } })
  await authDb.tenant.deleteMany({ where: { id: tenantId } })
})

async function call(method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** The submit URL the admin Counts tab calls, with the count id replaced. */
function clientSubmitPath(countId: string) {
  const src = readFileSync(new URL('../../../client/src/pages/admin/warehouse/tabs/counts-tab.tsx', import.meta.url), 'utf8')
  const m = src.match(/api\.patch\(`\/wms\/cycle-counts\/\$\{id\}\/([\w-]+)`\)/)
  assert.ok(m, 'counts-tab.tsx submit call not found')
  return `/wms/cycle-counts/${countId}/${m[1]}`
}

test('a count can be submitted for approval through the same URL the Counts tab uses', async () => {
  const created = await call('POST', '/wms/cycle-counts', { warehouseId, type: 'FULL' })
  assert.equal(created.status, 201)
  const countId = created.body.id as string

  const sheet = await call('GET', `/wms/cycle-counts/${countId}`)
  const [line] = sheet.body.lines as Array<Record<string, unknown>>
  // The sheet names the product and bin instead of showing internal ids.
  assert.equal(line.skuCode, 'PEN-100')
  assert.equal(line.skuName, 'Office Pen Pack')
  assert.equal(line.binCode, 'A-01-03')

  assert.equal((await call('PATCH', `/wms/cycle-counts/${countId}/lines/${line.id}`, { countedQty: 11 })).status, 200)
  const submitted = await call('PATCH', clientSubmitPath(countId))
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body))
  assert.equal(submitted.body.status, 'PENDING_APPROVAL')
})
