import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb, tenantDb } from './db'
import * as admin from './user-admin'

const cli: admin.Actor = { kind: 'cli', label: 'test' }
const tag = randomUUID().slice(0, 8)
const email = (name: string) => `${name}-${tag}@user-admin.test`
const ADMIN_PASSWORD = 'CompanyAdmin123'
const createdTenantIds: string[] = []
let tenantA = ''
let adminToken = ''

async function makeCompanyAdmin(name: string, slug: string) {
  const { user } = await admin.createUser(
    {
      email: email(name),
      firstName: 'Ada',
      lastName: 'Admin',
      role: 'TENANT_ADMIN',
      password: ADMIN_PASSWORD,
      newTenant: { companyName: `User Admin ${slug}`, slug },
    },
    cli,
  )
  createdTenantIds.push(user.tenant!.id)
  return user
}

before(async () => {
  tenantA = (await makeCompanyAdmin('admin-a', `ua-a-${tag}`)).tenant!.id
  await makeCompanyAdmin('admin-b', `ua-b-${tag}`)
  adminToken = (await loginUser(email('admin-a'), ADMIN_PASSWORD)).accessToken
})

after(async () => {
  const users = await authDb.user.findMany({ where: { email: { endsWith: `-${tag}@user-admin.test` } } })
  const ids = users.map((u) => u.id)
  await authDb.authSession.deleteMany({ where: { userId: { in: ids } } })
  await authDb.user.deleteMany({ where: { id: { in: ids } } })
  await tenantDb.auditEvent.deleteMany({ where: { entityId: { in: ids } } }).catch(() => undefined)
  await tenantDb.tenantOnboardingStep.deleteMany({ where: { tenantId: { in: createdTenantIds } } }).catch(() => undefined)
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: createdTenantIds } } }).catch(() => undefined)
  await authDb.tenant.deleteMany({ where: { id: { in: createdTenantIds } } }).catch(() => undefined)
})

function call(method: string, path: string, token: string, body?: unknown) {
  return handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

async function staff(name: string, role = 'WAREHOUSE_STAFF', tenantId = tenantA) {
  const { user } = await admin.createUser(
    { email: email(name), firstName: 'Sam', lastName: 'Staff', role, tenantId, password: 'StaffPass12345' },
    cli,
  )
  return user
}

test('the CLI creates users with a working temporary password and refuses duplicate emails', async () => {
  const result = await admin.createUser(
    { email: email('picker'), firstName: 'Pia', lastName: 'Picker', role: 'WAREHOUSE_STAFF', tenantId: tenantA },
    cli,
  )
  assert.ok(result.temporaryPassword)
  assert.equal(result.user.emailVerified, true)
  assert.ok((await loginUser(email('picker'), result.temporaryPassword!)).accessToken)
  await assert.rejects(
    admin.createUser({ email: email('picker'), firstName: 'X', lastName: 'Y', role: 'STAFF', tenantId: tenantA }, cli),
    { status: 409 },
  )
})

test('a company admin resets a team member password: temporary password works, old sessions end', async () => {
  const user = await staff('reset-me')
  const old = await loginUser(email('reset-me'), 'StaffPass12345')

  const res = await call('POST', `/users/${user.id}/reset-password`, adminToken)
  assert.equal(res.status, 200)
  const { temporaryPassword } = (await res.json()) as { temporaryPassword: string }
  assert.ok(temporaryPassword)
  assert.equal((await call('GET', '/auth/me', old.accessToken)).status, 401)
  assert.ok((await loginUser(email('reset-me'), temporaryPassword)).accessToken)
})

test('deactivated users can be reactivated from Settings', async () => {
  const user = await staff('come-back')
  assert.equal((await call('DELETE', `/users/${user.id}`, adminToken)).status, 200)
  await assert.rejects(loginUser(email('come-back'), 'StaffPass12345'))
  assert.equal((await call('POST', `/users/${user.id}/reactivate`, adminToken)).status, 200)
  assert.ok((await loginUser(email('come-back'), 'StaffPass12345')).accessToken)
})

test('sign out everywhere ends every session of that user', async () => {
  const user = await staff('signout')
  const session = await loginUser(email('signout'), 'StaffPass12345')
  assert.equal((await call('POST', `/users/${user.id}/revoke-sessions`, adminToken)).status, 200)
  assert.equal((await call('GET', '/auth/me', session.accessToken)).status, 401)
})

test('a company admin cannot touch users in another company', async () => {
  const outsider = await admin.findUserByEmail(email('admin-b'))
  for (const action of ['reset-password', 'reset-link', 'revoke-sessions', 'reactivate']) {
    assert.equal((await call('POST', `/users/${outsider.id}/${action}`, adminToken)).status, 404, action)
  }
})

test('super admins are read-only in Settings and cannot be created there', async () => {
  const superAdmin = await staff('platform', 'SUPER_ADMIN')
  assert.equal((await call('POST', `/users/${superAdmin.id}/reset-password`, adminToken)).status, 403)
  assert.equal((await call('PATCH', `/users/${superAdmin.id}`, adminToken, { role: 'STAFF' })).status, 403)
  assert.equal((await call('DELETE', `/users/${superAdmin.id}`, adminToken)).status, 403)

  const member = await staff('promote-me')
  assert.equal((await call('PATCH', `/users/${member.id}`, adminToken, { role: 'SUPER_ADMIN' })).status, 400)
})

test('an admin cannot reset their own password from the team list', async () => {
  const me = await admin.findUserByEmail(email('admin-a'))
  assert.equal((await call('POST', `/users/${me.id}/reset-password`, adminToken)).status, 400)
})

test('the team list shows last login and active sessions', async () => {
  const res = await call('GET', '/users?page=1&pageSize=100', adminToken)
  const { items } = (await res.json()) as { items: Array<{ email: string; activeSessions: number; emailVerified: boolean }> }
  const me = items.find((u) => u.email === email('admin-a'))!
  assert.ok(me.activeSessions >= 1)
  assert.equal(me.emailVerified, true)
})

test('bootstrap creates a super admin and later recovers it with a new password', async () => {
  const first = await admin.bootstrapSuperAdmin({ email: email('ops'), password: 'OpsPassword123' }, cli)
  assert.equal(first.status, 'created')
  const again = await admin.bootstrapSuperAdmin({ email: email('ops'), password: 'OpsPassword456' }, cli)
  assert.equal(again.status, 'updated')
  await assert.rejects(loginUser(email('ops'), 'OpsPassword123'))
  assert.ok((await loginUser(email('ops'), 'OpsPassword456')).accessToken)
})
