import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import * as jose from 'jose'
import {
  changePassword,
  loginUser,
  logoutUser,
  refreshUserTokens,
  resetPassword,
} from './auth'
import { authDb } from './db'
import { jwtSecret } from './env'
import { getSession, invalidateUserSessionCache } from './session'
import { deactivateUser } from './users'

const PASSWORD = 'session-test-pass-1'
let tenantId = ''
const createdUserIds: string[] = []

before(async () => {
  const tenant = await authDb.tenant.create({
    data: { name: 'Session Test', slug: `session-test-${randomUUID().slice(0, 8)}`, settings: {} },
  })
  tenantId = tenant.id
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: createdUserIds } } })
  await authDb.user.deleteMany({ where: { id: { in: createdUserIds } } })
  await authDb.tenant.delete({ where: { id: tenantId } }).catch(() => undefined)
})

async function makeUser(opts: { permissions?: string[] } = {}) {
  const email = `session-${randomUUID().slice(0, 8)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: 'Sess',
      lastName: 'Ion',
      role: 'MANAGER',
      permissions: opts.permissions ?? [],
      emailVerifiedAt: new Date(),
    },
  })
  createdUserIds.push(user.id)
  return user
}

function bearer(token: string): Request {
  return new Request('http://localhost/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } })
}

test('two devices can sign in and refresh independently', async () => {
  const user = await makeUser()
  const laptop = await loginUser(user.email, PASSWORD)
  const phone = await loginUser(user.email, PASSWORD)

  const laptop2 = await refreshUserTokens(laptop.refreshToken)
  const phone2 = await refreshUserTokens(phone.refreshToken)
  assert.ok(laptop2.accessToken)
  assert.ok(phone2.accessToken)
  assert.equal(await authDb.authSession.count({ where: { userId: user.id, revokedAt: null } }), 2)
})

test('a just-rotated refresh token works during the grace window, then counts as reuse', async () => {
  const user = await makeUser()
  const first = await loginUser(user.email, PASSWORD)
  const second = await refreshUserTokens(first.refreshToken)

  // Second tab racing the first: same old token, inside the grace window.
  const racing = await refreshUserTokens(first.refreshToken)
  assert.ok(racing.refreshToken)

  // Push the rotation into the past: the old token is now a replay and kills the session.
  const sid = jose.decodeJwt(second.refreshToken).sid as string
  await authDb.authSession.update({ where: { id: sid }, data: { rotatedAt: new Date(Date.now() - 60_000) } })
  await assert.rejects(refreshUserTokens(first.refreshToken), { status: 401 })
  await assert.rejects(refreshUserTokens(racing.refreshToken), { status: 401 })
})

test('access and refresh tokens cannot stand in for each other', async () => {
  const user = await makeUser()
  const pair = await loginUser(user.email, PASSWORD)
  assert.ok(await getSession(bearer(pair.accessToken)))
  assert.equal(await getSession(bearer(pair.refreshToken)), null)
  await assert.rejects(refreshUserTokens(pair.accessToken), { status: 401 })
})

test('logout ends only that device, and its access token stops working', async () => {
  const user = await makeUser()
  const laptop = await loginUser(user.email, PASSWORD)
  const phone = await loginUser(user.email, PASSWORD)
  const laptopSid = jose.decodeJwt(laptop.refreshToken).sid as string

  await logoutUser(user.id, laptopSid)
  assert.equal(await getSession(bearer(laptop.accessToken)), null)
  await assert.rejects(refreshUserTokens(laptop.refreshToken), { status: 401 })
  assert.ok(await getSession(bearer(phone.accessToken)))
  assert.ok(await refreshUserTokens(phone.refreshToken))
})

test('password reset ends every session; password change keeps the current one', async () => {
  const user = await makeUser()
  const a = await loginUser(user.email, PASSWORD)
  const b = await loginUser(user.email, PASSWORD)
  const aSid = jose.decodeJwt(a.accessToken).sid as string

  await changePassword(user.id, PASSWORD, 'session-test-pass-2', aSid)
  assert.ok(await getSession(bearer(a.accessToken)))
  assert.equal(await getSession(bearer(b.accessToken)), null)

  const token = 'known-reset-token'
  await authDb.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: createHash('sha256').update(token).digest('hex'),
      passwordResetExpiresAt: new Date(Date.now() + 60_000),
    },
  })
  await resetPassword(token, 'session-test-pass-3')
  assert.equal(await getSession(bearer(a.accessToken)), null)
  await assert.rejects(refreshUserTokens(a.refreshToken), { status: 401 })
})

test('deactivated users can neither use nor refresh their sessions', async () => {
  const user = await makeUser()
  const pair = await loginUser(user.email, PASSWORD)
  await deactivateUser(tenantId, user.id)
  assert.equal(await getSession(bearer(pair.accessToken)), null)
  await assert.rejects(refreshUserTokens(pair.refreshToken), { status: 401 })
})

test('clearing custom permissions takes effect without waiting for the token to expire', async () => {
  const user = await makeUser({ permissions: ['finance.*'] })
  const pair = await loginUser(user.email, PASSWORD)
  assert.deepEqual((await getSession(bearer(pair.accessToken)))?.permissions, ['finance.*'])

  await authDb.user.update({ where: { id: user.id }, data: { permissions: [] } })
  invalidateUserSessionCache(user.id)
  // Empty means "role defaults"; the token's stale custom list must not come back.
  assert.deepEqual((await getSession(bearer(pair.accessToken)))?.permissions, [])
})

test('a refresh token from before per-device sessions refreshes once and moves onto a session', async () => {
  const user = await makeUser()
  const legacyRefresh = await new jose.SignJWT({ sub: user.id, email: user.email, role: user.role, tenantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(process.env.JWT_REFRESH_SECRET?.trim() || jwtSecret()))
  await authDb.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: await bcrypt.hash(legacyRefresh, 4) },
  })

  const migrated = await refreshUserTokens(legacyRefresh)
  assert.equal(typeof jose.decodeJwt(migrated.refreshToken).sid, 'string')
  await assert.rejects(refreshUserTokens(legacyRefresh), { status: 401 })
})
