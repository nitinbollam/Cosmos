import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, tenantDb } from './db'
import { assertGrantableRole } from './users'

const PASSWORD = 'escalation-test-pass-1'
let tenantId = ''
const userIds: string[] = []

before(async () => {
  const tenant = await authDb.tenant.create({
    data: { name: 'Escalation Test', slug: `escalation-${randomUUID().slice(0, 8)}`, settings: {} },
  })
  tenantId = tenant.id
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: tenant.slug, displayName: 'Escalation Test', settings: {}, metadata: {} },
  })
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await tenantDb.tenantInvite.deleteMany({ where: { tenantId } }).catch(() => undefined)
  await tenantDb.tenantOrganization.delete({ where: { id: tenantId } }).catch(() => undefined)
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

async function tokenFor(role: 'MANAGER' | 'TENANT_ADMIN' | 'STAFF', permissions: string[] = []) {
  return (await userFor(role, permissions)).token
}

async function userFor(role: 'MANAGER' | 'TENANT_ADMIN' | 'STAFF', permissions: string[] = []) {
  const email = `esc-${randomUUID().slice(0, 8)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: 'E',
      lastName: 'S',
      role,
      permissions,
      emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  return { id: user.id, token: (await loginUser(email, PASSWORD)).accessToken }
}

function call(token: string, method: string, path: string, body?: unknown) {
  return handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

function invite(token: string, role: string) {
  return handleApiRequest(
    new Request('http://localhost/api/v1/tenants/me/invites', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `new-${randomUUID().slice(0, 6)}@example.test`, role }),
    }),
  )
}

test('a manager (read-only on users) cannot send invites at all', async () => {
  const manager = await tokenFor('MANAGER')
  for (const role of ['SUPER_ADMIN', 'TENANT_ADMIN', 'STAFF']) {
    const res = await invite(manager, role)
    assert.equal(res.status, 403, `manager inviting ${role}`)
  }
})

test('nobody inside a tenant can invite a platform super admin', async () => {
  const admin = await tokenFor('TENANT_ADMIN')
  const res = await invite(admin, 'SUPER_ADMIN')
  assert.equal(res.status, 400)
})

test('role grants: tenant roles only, and only admins can make admins', () => {
  assert.throws(() => assertGrantableRole('SUPER_ADMIN', 'TENANT_ADMIN'), { status: 400 })
  assert.throws(() => assertGrantableRole('MADE_UP', 'TENANT_ADMIN'), { status: 400 })
  assert.throws(() => assertGrantableRole('TENANT_ADMIN', 'MANAGER'), { status: 403 })
  assert.doesNotThrow(() => assertGrantableRole('TENANT_ADMIN', 'TENANT_ADMIN'))
  assert.doesNotThrow(() => assertGrantableRole('DRIVER', 'MANAGER'))
})

// The reported case: a manager who has been given user-management rights (users.write).
test('a manager with user rights cannot make anyone a Tenant Admin, by invite or by role change', async () => {
  const manager = await tokenFor('MANAGER', ['users.read', 'users.write', 'orders.*'])
  const res = await invite(manager, 'TENANT_ADMIN')
  assert.equal(res.status, 403)
  assert.match(((await res.json()) as { message: string }).message, /Only an administrator can grant the Tenant Admin role/)
  assert.equal((await invite(manager, 'STAFF')).status, 200)

  const staff = await userFor('STAFF')
  assert.equal((await call(manager, 'PATCH', `/users/${staff.id}`, { role: 'TENANT_ADMIN' })).status, 403)
  assert.equal((await call(manager, 'PATCH', `/users/${staff.id}`, { role: 'SALES_REP' })).status, 200)
})

test('a manager with user rights cannot hand out access they do not have, including to themselves', async () => {
  const me = await userFor('MANAGER', ['users.read', 'users.write', 'orders.*'])
  const staff = await userFor('STAFF')
  assert.equal((await call(me.token, 'PATCH', `/users/${me.id}`, { permissions: ['*'] })).status, 403)
  assert.equal((await call(me.token, 'PATCH', `/users/${staff.id}`, { permissions: ['*'] })).status, 403)
  assert.equal((await call(me.token, 'PATCH', `/users/${staff.id}`, { permissions: ['finance.*'] })).status, 403)
  assert.equal((await call(me.token, 'PATCH', `/users/${staff.id}`, { permissions: ['orders.read'] })).status, 200)
})

test("a manager with user rights cannot take over or lock out an administrator's account", async () => {
  const manager = await tokenFor('MANAGER', ['users.read', 'users.write'])
  const admin = await userFor('TENANT_ADMIN')
  for (const [method, path, body] of [
    ['PATCH', `/users/${admin.id}`, { role: 'STAFF' }],
    ['PATCH', `/users/${admin.id}`, { permissions: [] }],
    ['DELETE', `/users/${admin.id}`, undefined],
    ['POST', `/users/${admin.id}/reset-password`, undefined],
    ['POST', `/users/${admin.id}/revoke-sessions`, undefined],
  ] as const) {
    assert.equal((await call(manager, method, path, body)).status, 403, `${method} ${path}`)
  }
})

test('administrators keep full control', async () => {
  const admin = await tokenFor('TENANT_ADMIN')
  assert.equal((await invite(admin, 'TENANT_ADMIN')).status, 200)
  const other = await userFor('TENANT_ADMIN')
  assert.equal((await call(admin, 'POST', `/users/${other.id}/reset-password`)).status, 200)
})

test('a manager can still grant roles at their own level and below, and see pending invites', async () => {
  const withRights = await tokenFor('MANAGER', ['users.read', 'users.write', 'orders.*'])
  assert.equal((await invite(withRights, 'MANAGER')).status, 200)
  assert.equal((await invite(withRights, 'WAREHOUSE_STAFF')).status, 200)
  const plain = await tokenFor('MANAGER')
  assert.equal((await call(plain, 'GET', '/tenants/me/invites')).status, 200)
})
