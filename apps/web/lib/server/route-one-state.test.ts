import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, dispatchDb, tenantDb } from './db'

const PASSWORD = 'one-state-test-pass-1'
const tenantId = `t-${randomUUID()}`
let userId = ''
let token = ''

const post = (path: string, body: unknown) =>
  handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'S', slug: `s-${tenantId.slice(-8)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `s-${tenantId.slice(-8)}`, displayName: 'S', settings: {}, metadata: {} },
  })
  const email = `mgr-${randomUUID().slice(0, 6)}@example.test`
  const u = await authDb.user.create({
    data: {
      tenantId, email, passwordHash: await bcrypt.hash(PASSWORD, 4), firstName: 'M', lastName: 'U', role: 'MANAGER',
      permissions: [], emailVerifiedAt: new Date(),
    },
  })
  userId = u.id
  token = (await loginUser(email, PASSWORD)).accessToken
})

after(async () => {
  await dispatchDb.deliveryRoute.deleteMany({ where: { tenantId } })
  await authDb.authSession.deleteMany({ where: { userId } })
  await authDb.user.deleteMany({ where: { id: userId } })
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

test('a route with stops in two states is refused and names both', async () => {
  const res = await post('/routes', {
    name: 'mixed',
    stops: [
      { sequence: 1, address: { line1: '1 Main St', state: 'FL' } },
      { sequence: 2, address: { line1: '2 Oak Ave', state: 'ga' } },
    ],
  })
  assert.equal(res.status, 400)
  const body = (await res.json()) as { error?: string; message?: string }
  assert.match(String(body.error ?? body.message), /FL, GA/)
  assert.equal(await dispatchDb.deliveryRoute.count({ where: { tenantId } }), 0)
})

test('a route within one state is created, and stops without a state do not block it', async () => {
  const res = await post('/routes', {
    name: 'one state',
    stops: [
      { sequence: 1, address: { line1: '1 Main St', state: 'FL' } },
      { sequence: 2, address: { line1: '2 Oak Ave', state: 'Florida' } },
      { sequence: 3, address: { line1: '3 Elm St' } },
    ],
  })
  assert.equal(res.status, 201)
})
