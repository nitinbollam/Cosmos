import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, crmDb, storefrontDb } from './db'

const PASSWORD = 'template-test-pass-1'
let tenantId = ''
const userIds: string[] = []
const customers: Record<'a' | 'b', { id: string; email: string }> = {} as never
const templates: Record<'a' | 'b', string> = {} as never

before(async () => {
  const tenant = await authDb.tenant.create({
    data: { name: 'Template Access Test', slug: `templates-${randomUUID().slice(0, 8)}`, settings: {} },
  })
  tenantId = tenant.id
  for (const key of ['a', 'b'] as const) {
    const email = `buyer-${key}-${randomUUID().slice(0, 8)}@example.test`
    const customer = await crmDb.customer.create({ data: { tenantId, name: `Customer ${key}`, email } })
    customers[key] = { id: customer.id, email }
    const template = await storefrontDb.orderTemplate.create({
      data: { tenantId, customerRef: customer.id, name: `Weekly ${key}`, lines: { create: [{ skuId: 'sku-1', quantity: 2 }] } },
    })
    templates[key] = template.id
  }
})

after(async () => {
  await storefrontDb.orderTemplate.deleteMany({ where: { tenantId } })
  await crmDb.customer.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

async function tokenFor(role: 'STAFF' | 'DRIVER' | 'MANAGER', email = `tpl-${randomUUID().slice(0, 8)}@example.test`) {
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: 'T',
      lastName: 'A',
      role,
      permissions: [],
      emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  return (await loginUser(email, PASSWORD)).accessToken
}

function call(token: string, method: string, path: string, body?: unknown) {
  return handleApiRequest(
    new Request(`http://localhost/api/v1/order-templates${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

test("a buyer naming another customer's id still only gets their own templates", async () => {
  const buyerA = await tokenFor('STAFF', customers.a.email)
  const res = await call(buyerA, 'GET', `?customerRef=${customers.b.id}`)
  assert.equal(res.status, 200)
  const rows = (await res.json()) as Array<{ id: string }>
  assert.deepEqual(rows.map((r) => r.id), [templates.a])
})

test('staff need order rights: read to list, write to create or delete', async () => {
  const driver = await tokenFor('DRIVER')
  assert.equal((await call(driver, 'GET', `?customerRef=${customers.b.id}`)).status, 200)
  const create = await call(driver, 'POST', '', { customerRef: customers.b.id, name: 'x', lines: [{ skuId: 's', quantity: 1 }] })
  assert.equal(create.status, 403)
  assert.equal((await call(driver, 'DELETE', `/${templates.b}`)).status, 403)
  assert.ok(await storefrontDb.orderTemplate.findUnique({ where: { id: templates.b } }))

  const manager = await tokenFor('MANAGER')
  const res = await call(manager, 'GET', `?customerRef=${customers.b.id}`)
  assert.equal(res.status, 200)
  assert.deepEqual(((await res.json()) as Array<{ id: string }>).map((r) => r.id), [templates.b])
})
