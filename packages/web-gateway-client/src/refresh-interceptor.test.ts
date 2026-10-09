import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import { createGatewayApi } from './index'

const memory = new Map<string, string>()

beforeEach(() => {
  memory.clear()
  memory.set('pleros.accessToken', 'old-access')
  memory.set('pleros.refreshToken', 'old-refresh')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      localStorage: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => memory.set(k, v),
        removeItem: (k: string) => memory.delete(k),
      },
      location: { pathname: '/admin/orders', assign: mock.fn() },
    },
  })
})

/** Adapter that answers 401 to any request not carrying `validToken`. */
function adapterAccepting(validToken: string, status = 401): { adapter: AxiosAdapter; seen: string[] } {
  const seen: string[] = []
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const auth = String(config.headers?.Authorization ?? '')
    seen.push(`${config.url} ${auth}`)
    if (auth === `Bearer ${validToken}`) {
      return { data: { ok: true, url: config.url }, status: 200, statusText: 'OK', headers: {}, config }
    }
    const error = Object.assign(new Error(`Request failed with status code ${status}`), {
      config,
      response: { status, data: { message: 'nope' }, headers: {}, config, statusText: '' },
      isAxiosError: true,
    })
    throw error
  }
  return { adapter, seen }
}

test('concurrent 401s share one refresh and every request is retried with the new token', async () => {
  const refresh = mock.fn(async () => {
    await new Promise((r) => setTimeout(r, 5))
    memory.set('pleros.accessToken', 'new-access')
    return 'new-access'
  })
  let inFlight: Promise<string | null> | null = null
  const singleFlight = () => (inFlight ??= refresh().finally(() => (inFlight = null)))
  const onUnauthorized = mock.fn()
  const { api, client } = createGatewayApi({ baseUrl: '/api/v1', refresh: singleFlight, onUnauthorized })
  const { adapter } = adapterAccepting('new-access')
  client.defaults.adapter = adapter

  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => api.get<{ ok: boolean }>(`/orders/${n}`)))
  assert.equal(results.every((r) => r.ok), true)
  assert.equal(refresh.mock.callCount(), 1)
  assert.equal(onUnauthorized.mock.callCount(), 0)
})

test('a failed refresh signs out exactly once per request and does not loop', async () => {
  const refresh = mock.fn(async () => null)
  const onUnauthorized = mock.fn()
  const { api, client } = createGatewayApi({ baseUrl: '/api/v1', refresh, onUnauthorized })
  const { adapter, seen } = adapterAccepting('never')
  client.defaults.adapter = adapter

  await assert.rejects(api.get('/orders'))
  assert.equal(refresh.mock.callCount(), 1)
  assert.equal(onUnauthorized.mock.callCount(), 1)
  assert.equal(seen.length, 1)
})

test('a transient refresh failure keeps the session', async () => {
  const refresh = mock.fn(async () => {
    throw new Error('offline')
  })
  const onUnauthorized = mock.fn()
  const { api, client } = createGatewayApi({ baseUrl: '/api/v1', refresh, onUnauthorized })
  client.defaults.adapter = adapterAccepting('never').adapter

  await assert.rejects(api.get('/orders'))
  assert.equal(onUnauthorized.mock.callCount(), 0)
  assert.equal(memory.get('pleros.accessToken'), 'old-access')
})

test('503 never signs anyone out', async () => {
  const refresh = mock.fn(async () => 'x')
  const onUnauthorized = mock.fn()
  const { api, client } = createGatewayApi({ baseUrl: '/api/v1', refresh, onUnauthorized })
  client.defaults.adapter = adapterAccepting('never', 503).adapter

  await assert.rejects(api.get('/orders'))
  assert.equal(refresh.mock.callCount(), 0)
  assert.equal(onUnauthorized.mock.callCount(), 0)
})

test('a wrong password at login is not treated as an expired session', async () => {
  const refresh = mock.fn(async () => 'x')
  const onUnauthorized = mock.fn()
  const { api, client } = createGatewayApi({ baseUrl: '/api/v1', refresh, onUnauthorized })
  client.defaults.adapter = adapterAccepting('never').adapter

  await assert.rejects(api.post('/auth/login', { email: 'a', password: 'b' }))
  assert.equal(refresh.mock.callCount(), 0)
  assert.equal(onUnauthorized.mock.callCount(), 0)
})

test('getAccessToken supplies the header, so a proactively refreshed token is used', async () => {
  const { api, client } = createGatewayApi({ baseUrl: '/api/v1', getAccessToken: async () => 'fresh' })
  const { adapter, seen } = adapterAccepting('fresh')
  client.defaults.adapter = adapter
  await api.get('/me')
  assert.deepEqual(seen, ['/me Bearer fresh'])
})
