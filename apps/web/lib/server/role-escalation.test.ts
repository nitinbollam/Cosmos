import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb } from './db'
import { assertGrantableRole } from './users'

const PASSWORD = 'escalation-test-pass-1'
let tenantId = ''
const userIds: string[] = []

before(async () => {
  const tenant = await authDb.tenant.create({
    data: { name: 'Escalation Test', slug: `escalation-${randomUUID().slice(0, 8)}`, settings: {} },
  })
  tenantId = tenant.id
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

async function tokenFor(role: 'MANAGER' | 'TENANT_ADMIN') {
  const email = `esc-${randomUUID().slice(0, 8)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: 'E',
      lastName: 'S',
      role,
      permissions: [],
      emailVerifiedAt: new Date(),
    },
  })
  userIds.push(user.id)
  return (await loginUser(email, PASSWORD)).accessToken
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
