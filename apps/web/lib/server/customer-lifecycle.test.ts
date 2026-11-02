import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-order'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, orderDb, storefrontDb, tenantDb } from './db'
import { createOrder } from './orders'
import { createQuote } from './quotes'

const PASSWORD = 'customer-lifecycle-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []

async function login(role: 'MANAGER' | 'WAREHOUSE_STAFF') {
  const email = `${role.toLowerCase()}-${randomUUID().slice(0, 6)}@example.test`
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

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}

let manager = ''

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'Life', slug: `life-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `life-${tenantId.slice(-8)}`, displayName: 'Life', settings: {}, metadata: {} },
  })
  manager = await login('MANAGER')
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await storefrontDb.b2BQuote.deleteMany({ where: { tenantId } })
  await orderDb.order.deleteMany({ where: { tenantId } })
  await crmDb.volumePriceBreak.deleteMany({ where: { tenantId } })
  await crmDb.customerPrice.deleteMany({ where: { tenantId } })
  await crmDb.activity.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await tenantDb.tenantOrganization.deleteMany({ where: { id: tenantId } })
  await authDb.tenant.deleteMany({ where: { id: tenantId } })
})

test('a customer can be edited: details are trimmed, blanks clear, and bad values are refused', async () => {
  const customer = await crmDb.customer.create({ data: { tenantId, name: '=1+1', email: 't19-test@example.com', phone: '555' } })
  const ok = await call(manager, 'PATCH', `/customers/${customer.id}`, {
    name: '  Acme Corp ',
    email: 'billing@acme.test',
    phone: '',
    primaryCity: ' Tampa ',
    paymentTermsDays: 30,
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.body?.name, 'Acme Corp')
  assert.equal(ok.body?.phone, null)
  assert.equal(ok.body?.primaryCity, 'Tampa')
  assert.equal(ok.body?.paymentTermsDays, 30)

  assert.equal((await call(manager, 'PATCH', `/customers/${customer.id}`, { name: '   ' })).status, 400)
  assert.equal((await call(manager, 'PATCH', `/customers/${customer.id}`, { email: 'not-an-email' })).status, 400)
  assert.equal((await call(manager, 'PATCH', `/customers/${customer.id}`, { paymentTermsDays: 2.5 })).status, 400)
  assert.equal((await crmDb.customer.findUniqueOrThrow({ where: { id: customer.id } })).name, 'Acme Corp')
})

test('a deactivated customer keeps its history, leaves the pickers, and gets no new orders or quotes', async () => {
  const customer = await crmDb.customer.create({ data: { tenantId, name: 'Closed Account' } })
  const order = await orderDb.order.create({
    data: {
      tenantId,
      customerId: customer.id,
      status: 'DELIVERED',
      channel: 'SALES_REP',
      totalAmount: new Prisma.Decimal(10),
      paymentMethod: 'CASH',
    },
  })

  const off = await call(manager, 'PATCH', `/customers/${customer.id}`, { isActive: false })
  assert.equal(off.status, 200)
  assert.equal(off.body?.isActive, false)
  assert.ok(off.body?.deactivatedAt)

  const picker = (await call(manager, 'GET', '/customers')).body as unknown as Array<{ id: string }>
  assert.equal(picker.some((c) => c.id === customer.id), false)
  const crmList = (await call(manager, 'GET', '/customers?page=1&pageSize=50&includeInactive=1')).body as { items: Array<{ id: string }> }
  assert.equal(crmList.items.some((c) => c.id === customer.id), true)
  assert.ok(await orderDb.order.findUnique({ where: { id: order.id } }), 'history is kept')

  await assert.rejects(
    createOrder(tenantId, {
      customerId: customer.id,
      lineItems: [{ skuId: 'sku-x', warehouseId: 'wh-x', quantity: 1, unitPrice: 5 }],
    } as Parameters<typeof createOrder>[1]),
    (e: { status?: number; message?: string }) => e.status === 409 && /deactivated/.test(e.message ?? ''),
  )
  await assert.rejects(
    createQuote(tenantId, { customerRef: customer.id, lines: [{ lineNo: 1, description: 'x', qty: 1, unitPrice: 5 }] }),
    (e: { status?: number }) => e.status === 409,
  )

  const on = await call(manager, 'PATCH', `/customers/${customer.id}`, { isActive: true })
  assert.equal(on.body?.isActive, true)
  assert.equal(on.body?.deactivatedAt, null)
  const quote = await createQuote(tenantId, { customerRef: customer.id, lines: [{ lineNo: 1, description: 'x', qty: 1, unitPrice: 5 }] })
  assert.ok(quote.id, 'reactivated customers can be quoted again')
})

test('a customer with orders cannot be deleted; one with no history can, with its own CRM rows', async () => {
  const used = await crmDb.customer.create({ data: { tenantId, name: 'Has Orders' } })
  await orderDb.order.create({
    data: {
      tenantId,
      customerId: used.id,
      status: 'PENDING',
      channel: 'SALES_REP',
      totalAmount: new Prisma.Decimal(1),
      paymentMethod: 'CASH',
    },
  })
  const refused = await call(manager, 'DELETE', `/customers/${used.id}`)
  assert.equal(refused.status, 409)
  assert.match(String(refused.body?.message), /1 order\b.*Deactivate it instead/)
  assert.ok(await crmDb.customer.findUnique({ where: { id: used.id } }))

  const fresh = await crmDb.customer.create({ data: { tenantId, name: 'Typo Customer' } })
  await crmDb.customerPrice.create({ data: { tenantId, customerId: fresh.id, skuId: 'sku-1', unitPrice: 3 } })
  await crmDb.volumePriceBreak.create({ data: { tenantId, customerId: fresh.id, skuId: 'sku-1', minQty: 10, unitPrice: 2 } })
  const activity = await crmDb.activity.create({ data: { tenantId, type: 'NOTE', subject: 'hi', customerId: fresh.id } })

  const deleted = await call(manager, 'DELETE', `/customers/${fresh.id}`)
  assert.equal(deleted.status, 200)
  assert.equal(await crmDb.customer.findUnique({ where: { id: fresh.id } }), null)
  assert.equal(await crmDb.customerPrice.count({ where: { customerId: fresh.id } }), 0)
  assert.equal(await crmDb.volumePriceBreak.count({ where: { customerId: fresh.id } }), 0)
  assert.equal((await crmDb.activity.findUniqueOrThrow({ where: { id: activity.id } })).customerId, null)
  assert.equal((await call(manager, 'DELETE', `/customers/${fresh.id}`)).status, 404)
})

test('editing, deactivating and deleting need CRM write access', async () => {
  const customer = await crmDb.customer.create({ data: { tenantId, name: 'Guarded' } })
  const warehouse = await login('WAREHOUSE_STAFF')
  assert.equal((await call(warehouse, 'PATCH', `/customers/${customer.id}`, { isActive: false })).status, 403)
  assert.equal((await call(warehouse, 'DELETE', `/customers/${customer.id}`)).status, 403)
  assert.equal((await crmDb.customer.findUniqueOrThrow({ where: { id: customer.id } })).isActive, true)
})
