import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { authDb } from './db'

const PASSWORD = 'marketplace-test-pass-1'
const tenantId = `t-${randomUUID()}`
const userIds: string[] = []
const tokens: Record<'admin' | 'manager' | 'rep', string> = { admin: '', manager: '', rep: '' }

before(async () => {
  await authDb.tenant.create({ data: { id: tenantId, name: 'Market', slug: `mkt-${tenantId.slice(-8)}`, settings: {} } })
  for (const [key, role] of [
    ['admin', 'TENANT_ADMIN'],
    ['manager', 'MANAGER'],
    ['rep', 'SALES_REP'],
  ] as const) {
    const email = `${key}-${randomUUID().slice(0, 6)}@example.test`
    const user = await authDb.user.create({
      data: {
        tenantId,
        email,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        firstName: key,
        lastName: 'U',
        role,
        permissions: [],
        emailVerifiedAt: new Date(),
      },
    })
    userIds.push(user.id)
    tokens[key] = (await loginUser(email, PASSWORD)).accessToken
  }
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

function call(who: keyof typeof tokens, method: string, path: string, body?: unknown) {
  return handleApiRequest(
    new Request(`http://localhost/api/v1/marketplace${path}`, {
      method,
      headers: { authorization: `Bearer ${tokens[who]}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

const newListing = {
  skuId: 'no-such-sku',
  title: 'Surplus',
  category: 'Other',
  listingType: 'FIXED',
  priceCents: 1000,
  quantity: 1,
}

test('only administrators can create or remove listings, upload listing photos, or see their listings', async () => {
  for (const who of ['manager', 'rep'] as const) {
    assert.equal((await call(who, 'POST', '/listings', newListing)).status, 403, `${who} create`)
    assert.equal((await call(who, 'DELETE', '/listings/some-listing')).status, 403, `${who} remove`)
    assert.equal((await call(who, 'POST', '/uploads', { fileName: 'a.png', contentBase64: 'AA==' })).status, 403, `${who} upload`)
    assert.equal((await call(who, 'GET', '/listings?mine=true')).status, 403, `${who} my listings`)
  }

  // Administrators get past the role check (and on to the real validation).
  assert.notEqual((await call('admin', 'POST', '/listings', newListing)).status, 403)
  assert.notEqual((await call('admin', 'DELETE', '/listings/some-listing')).status, 403)
  assert.equal((await call('admin', 'GET', '/listings?mine=true')).status, 200)
})

test('non-administrators with marketplace access can still browse and buy', async () => {
  for (const who of ['manager', 'rep'] as const) {
    assert.equal((await call(who, 'GET', '/listings')).status, 200, `${who} browse`)
    assert.equal((await call(who, 'GET', '/orders?role=buyer')).status, 200, `${who} purchases`)
    // Buying a listing that doesn't exist fails on the listing, not on permission.
    const buy = await call(who, 'POST', '/orders', { listingId: 'no-such-listing', quantity: 1 })
    assert.notEqual(buy.status, 403, `${who} buy`)
  }
})
