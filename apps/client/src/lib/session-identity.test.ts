import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import {
  accessTokenKey,
  currentIdentity,
  migrateLegacyTokens,
  refreshTokenKey,
  surfaceFor,
} from './session-identity'

const memory = new Map<string, string>()

function fakeToken(sub: string, tenantId = 't1'): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256' })}.${b64({ sub, tenantId })}.sig`
}

function at(pathname: string) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      location: { pathname },
      localStorage: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => memory.set(k, v),
        removeItem: (k: string) => memory.delete(k),
      },
    },
  })
}

beforeEach(() => {
  memory.clear()
})

test('each part of the app maps to its own login', () => {
  assert.equal(surfaceFor('/admin'), 'admin')
  assert.equal(surfaceFor('/admin/orders/1'), 'admin')
  assert.equal(surfaceFor('/ops/marketplace'), 'admin')
  assert.equal(surfaceFor('/m'), 'mobile')
  assert.equal(surfaceFor('/m/delivery/route/r1'), 'mobile')
  assert.equal(surfaceFor('/catalog'), 'shop')
  assert.equal(surfaceFor('/marketplace'), 'shop')
  assert.equal(surfaceFor('/'), 'shop')
  // Prefix lookalikes are not the admin or mobile apps.
  assert.equal(surfaceFor('/administration'), 'shop')
  assert.equal(surfaceFor('/mobile'), 'shop')
})

test('three areas can be signed in as three different people at once', () => {
  at('/admin')
  memory.set(accessTokenKey('admin'), fakeToken('admin-user'))
  memory.set(accessTokenKey('shop'), fakeToken('buyer-user'))
  memory.set(accessTokenKey('mobile'), fakeToken('driver-user'))

  assert.equal(currentIdentity()?.userId, 'admin-user')
  assert.equal(currentIdentity('shop')?.userId, 'buyer-user')
  assert.equal(currentIdentity('mobile')?.userId, 'driver-user')
  at('/m/delivery')
  assert.equal(currentIdentity()?.userId, 'driver-user')
})

test('the old shared login moves to the area the user is in, and only that one', () => {
  at('/m/warehouse')
  memory.set('pleros.accessToken', 'old-access')
  memory.set('pleros.refreshToken', 'old-refresh')

  migrateLegacyTokens()
  assert.equal(memory.get(accessTokenKey('mobile')), 'old-access')
  assert.equal(memory.get(refreshTokenKey('mobile')), 'old-refresh')
  assert.equal(memory.get(accessTokenKey('admin')), undefined)
  assert.equal(memory.get(accessTokenKey('shop')), undefined)
  assert.equal(memory.has('pleros.accessToken'), false)
  assert.equal(memory.has('pleros.refreshToken'), false)
})

test('migration never overwrites a login the area already has', () => {
  at('/admin')
  memory.set(accessTokenKey('admin'), 'current-admin')
  memory.set('pleros.accessToken', 'old-access')
  migrateLegacyTokens()
  assert.equal(memory.get(accessTokenKey('admin')), 'current-admin')
  assert.equal(memory.has('pleros.accessToken'), false)
})
