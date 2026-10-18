import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import * as jose from 'jose'
import { loginUser, requestPasswordReset, resendEmailVerification } from './auth'
import { authDb } from './db'
import { ApiError, toJsonError } from './session'

const tenants: Array<{ id: string; slug: string }> = []
const userIds: string[] = []
const email = `jane-${randomUUID().slice(0, 8)}@example.test`

before(async () => {
  for (const name of ['acme', 'globex']) {
    const slug = `${name}-${randomUUID().slice(0, 8)}`
    const t = await authDb.tenant.create({ data: { name, slug, settings: {} } })
    tenants.push({ id: t.id, slug })
  }
})

after(async () => {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  await authDb.tenant.deleteMany({ where: { id: { in: tenants.map((t) => t.id) } } })
})

async function addUser(tenantIdx: number, password: string, over: Record<string, unknown> = {}) {
  const u = await authDb.user.create({
    data: {
      tenantId: tenants[tenantIdx].id,
      email,
      passwordHash: await bcrypt.hash(password, 4),
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'MANAGER',
      permissions: [],
      emailVerifiedAt: new Date(),
      ...over,
    },
  })
  userIds.push(u.id)
  return u
}

async function reset() {
  await authDb.authSession.deleteMany({ where: { userId: { in: userIds } } })
  await authDb.user.deleteMany({ where: { id: { in: userIds } } })
  userIds.length = 0
}

const tenantOf = (token: string) => jose.decodeJwt(token).tenantId as string

test('one email in two tenants with different passwords signs into each with the matching password', async () => {
  await reset()
  await addUser(0, 'acme-password-1')
  await addUser(1, 'globex-password-1')
  // Whichever row the database returns first, both users can get in.
  for (let i = 0; i < 3; i++) {
    assert.equal(tenantOf((await loginUser(email, 'acme-password-1')).accessToken), tenants[0].id)
    assert.equal(tenantOf((await loginUser(email, 'globex-password-1')).accessToken), tenants[1].id)
  }
})

test('the same password in two tenants signs nobody in until the company is named', async () => {
  await reset()
  await addUser(0, 'shared-password-1')
  await addUser(1, 'shared-password-1')
  await assert.rejects(
    () => loginUser(email, 'shared-password-1'),
    (err: unknown) => err instanceof ApiError && err.status === 409 && /company code/.test(err.message),
  )
  const byId = await loginUser(email, 'shared-password-1', {}, { tenantRef: tenants[1].id })
  assert.equal(tenantOf(byId.accessToken), tenants[1].id)
  const bySlug = await loginUser(email, 'shared-password-1', {}, { tenantRef: tenants[0].slug.toUpperCase() })
  assert.equal(tenantOf(bySlug.accessToken), tenants[0].id)
})

test('naming a company the person does not belong to is the same 401 as a wrong password', async () => {
  await reset()
  await addUser(0, 'acme-password-1')
  await assert.rejects(
    () => loginUser(email, 'acme-password-1', {}, { tenantRef: tenants[1].id }),
    (err: unknown) => err instanceof ApiError && err.status === 401,
  )
  await assert.rejects(
    () => loginUser(email, 'acme-password-1', {}, { tenantRef: 'no-such-company' }),
    (err: unknown) => err instanceof ApiError && err.status === 401,
  )
})

test('unknown email and wrong password give byte-identical 401s and both run bcrypt', async () => {
  await reset()
  await addUser(0, 'acme-password-1')
  const original = bcrypt.compare
  let calls = 0
  ;(bcrypt as unknown as { compare: unknown }).compare = (...a: Parameters<typeof original>) => {
    calls++
    return original(...a)
  }
  try {
    const bodies: string[] = []
    for (const [e, p] of [
      [email, 'wrong-password'],
      [`nobody-${randomUUID().slice(0, 6)}@example.test`, 'wrong-password'],
    ] as const) {
      calls = 0
      const err = await loginUser(e, p).then(
        () => null,
        (x: unknown) => x,
      )
      assert.ok(err instanceof ApiError && err.status === 401)
      assert.equal(calls, 1, `bcrypt ran once for ${e === email ? 'wrong password' : 'unknown email'}`)
      const res = toJsonError(err)
      bodies.push(`${res.status} ${await res.text()}`)
    }
    assert.equal(bodies[0], bodies[1])
  } finally {
    ;(bcrypt as unknown as { compare: unknown }).compare = original
  }
})

test('bcrypt runs once per candidate when several accounts share the email', async () => {
  await reset()
  await addUser(0, 'acme-password-1')
  await addUser(1, 'globex-password-1')
  const original = bcrypt.compare
  let calls = 0
  ;(bcrypt as unknown as { compare: unknown }).compare = (...a: Parameters<typeof original>) => {
    calls++
    return original(...a)
  }
  try {
    await assert.rejects(() => loginUser(email, 'nope'), (e: unknown) => e instanceof ApiError && e.status === 401)
    assert.equal(calls, 2)
  } finally {
    ;(bcrypt as unknown as { compare: unknown }).compare = original
  }
})

test('inactive accounts are ignored and an unverified signup is told to verify only after its password matches', async () => {
  await reset()
  await addUser(0, 'acme-password-1', { isActive: false })
  await assert.rejects(() => loginUser(email, 'acme-password-1'), (e: unknown) => e instanceof ApiError && e.status === 401)
  await addUser(1, 'globex-password-1', { emailVerifiedAt: null, emailVerificationTokenHash: 'pending' })
  await assert.rejects(() => loginUser(email, 'wrong'), (e: unknown) => e instanceof ApiError && e.status === 401)
  await assert.rejects(() => loginUser(email, 'globex-password-1'), (e: unknown) => e instanceof ApiError && e.status === 403)
})

test('password reset prepares a separate link for every tenant the email belongs to', async () => {
  await reset()
  const a = await addUser(0, 'acme-password-1')
  const b = await addUser(1, 'globex-password-1')
  await requestPasswordReset(email)
  const rows = await authDb.user.findMany({ where: { id: { in: [a.id, b.id] } } })
  assert.equal(rows.length, 2)
  for (const r of rows) assert.ok(r.passwordResetTokenHash, `${r.id} has its own reset token`)
  assert.notEqual(rows[0].passwordResetTokenHash, rows[1].passwordResetTokenHash)
})

test('verification resend reaches every unverified account for the email', async () => {
  await reset()
  const a = await addUser(0, 'acme-password-1', { emailVerifiedAt: null })
  const b = await addUser(1, 'globex-password-1', { emailVerifiedAt: null })
  assert.deepEqual(await resendEmailVerification('nobody-here@example.test'), { ok: true })
  const res = await resendEmailVerification(email)
  assert.equal(res.ok, true)
  const rows = await authDb.user.findMany({ where: { id: { in: [a.id, b.id] } } })
  for (const r of rows) assert.ok(r.emailVerificationTokenHash, `${r.id} was sent a link`)
})
