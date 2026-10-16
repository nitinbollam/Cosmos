import assert from 'node:assert/strict'
import test, { afterEach, mock } from 'node:test'

/** A browser with push support and one existing subscription. */
function installPushBrowser(opts: { fetch?: (...args: unknown[]) => Promise<unknown> } = {}) {
  const unsubscribe = mock.fn(async () => true)
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', unsubscribe }
  const registration = { pushManager: { getSubscription: async () => subscription } }
  const fetchMock = mock.fn(opts.fetch ?? (async () => ({ ok: true })))
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  define('window', { PushManager: function PushManager() {}, Notification: { permission: 'granted' } })
  define('navigator', { serviceWorker: { getRegistration: async () => registration }, userAgent: 'test' })
  define('fetch', fetchMock)
  return { unsubscribe, fetchMock }
}

afterEach(() => mock.restoreAll())

test('sign-out unsubscribes, then removes the device on the server with the still-valid token', async () => {
  const { unsubscribe, fetchMock } = installPushBrowser()
  const { forgetPushOnSignOut } = await import('./push')

  await forgetPushOnSignOut('https://shop.example/api/v1', 'token-123')

  assert.equal(fetchMock.mock.callCount(), 1)
  const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, { headers: Record<string, string>; body: string }]
  assert.equal(url, 'https://shop.example/api/v1/push/devices/remove')
  assert.equal(init.headers.Authorization, 'Bearer token-123')
  assert.deepEqual(JSON.parse(init.body), { token: 'https://fcm.googleapis.com/fcm/send/abc' })
  assert.equal(unsubscribe.mock.callCount(), 1)
})

test('sign-out still unsubscribes when the session is already gone', async () => {
  const { unsubscribe, fetchMock } = installPushBrowser()
  const { forgetPushOnSignOut } = await import('./push')

  await forgetPushOnSignOut('https://shop.example/api/v1', null)

  assert.equal(fetchMock.mock.callCount(), 0)
  assert.equal(unsubscribe.mock.callCount(), 1)
})

test('a server that never answers cannot hold sign-out, and the browser still unsubscribes', async () => {
  const { unsubscribe } = installPushBrowser({ fetch: () => new Promise(() => undefined) })
  const { forgetPushOnSignOut } = await import('./push')

  const started = Date.now()
  await forgetPushOnSignOut('https://shop.example/api/v1', 'token-123')
  assert.ok(Date.now() - started < 3000)
  assert.equal(unsubscribe.mock.callCount(), 1)
})
