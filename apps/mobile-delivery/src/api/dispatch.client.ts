import axios from 'axios'
import * as SecureStore from 'expo-secure-store'
import { toGatewayProxyPath } from './gatewayPath'

const baseURL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000/api/v1'

const client = axios.create({ baseURL, timeout: 20_000 })

export function parseAccessTokenClaims(accessToken: string): { tenantId?: string; sub?: string } {
  try {
    const body = accessToken.split('.')[1]
    if (!body) return {}
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 === 0 ? b64 : b64 + '='.repeat(4 - (b64.length % 4))
    const json = JSON.parse(atob(pad)) as { tenantId?: unknown; sub?: unknown }
    return {
      tenantId: typeof json.tenantId === 'string' ? json.tenantId : undefined,
      sub: typeof json.sub === 'string' ? json.sub : undefined,
    }
  } catch {
    return {}
  }
}

async function optionalAuthHeaders(
  token?: string | null,
  tenantId?: string | null,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  const t = token ?? (await SecureStore.getItemAsync('cosmos.accessToken'))
  const tid = tenantId ?? (await SecureStore.getItemAsync('cosmos.tenantId'))
  if (t) headers.Authorization = `Bearer ${t}`
  if (tid) headers['x-cosmos-tenant-id'] = tid
  return headers
}

client.interceptors.request.use(async (cfg) => {
  const token = await SecureStore.getItemAsync('cosmos.accessToken')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  const tenantId = await SecureStore.getItemAsync('cosmos.tenantId')
  if (tenantId) cfg.headers['x-cosmos-tenant-id'] = tenantId
  if (typeof cfg.url === 'string')
    cfg.url = toGatewayProxyPath(cfg.url.startsWith('/') ? cfg.url.slice(1) : cfg.url)
  return cfg
})

export const dispatchClient = {
  async login(email: string, password: string) {
    const r = await client.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
      email,
      password,
    })
    await SecureStore.setItemAsync('cosmos.accessToken', r.data.accessToken)
    await SecureStore.setItemAsync('cosmos.refreshToken', r.data.refreshToken)
    const claims = parseAccessTokenClaims(r.data.accessToken)
    if (claims.tenantId) await SecureStore.setItemAsync('cosmos.tenantId', claims.tenantId)
    else await SecureStore.deleteItemAsync('cosmos.tenantId')
    if (claims.sub) await SecureStore.setItemAsync('cosmos.userId', claims.sub)
    else await SecureStore.deleteItemAsync('cosmos.userId')
    return r.data
  },

  async updateDriverLocation(
    token?: string | null,
    tenantId?: string | null,
    body?: { lat: number; lng: number; timestamp: string; routeId?: string },
  ) {
    const r = await client.post('/dispatch/driver/location', body, {
      headers: await optionalAuthHeaders(token, tenantId),
    })
    return r.data
  },

  /** @deprecated use updateDriverLocation */
  async updateDriverLocationLegacy(lat: number, lng: number) {
    await client
      .post('/dispatch/driver/location', {
        lat,
        lng,
        timestamp: new Date().toISOString(),
      })
      .catch(() => undefined)
  },

  async recordPOD(token?: string | null, tenantId?: string | null, body: Record<string, unknown> = {}) {
    const stopId = String(body.stopId ?? '')
    const r = await client.post(`/dispatch/stops/${encodeURIComponent(stopId)}/pod`, body, {
      headers: await optionalAuthHeaders(token, tenantId),
    })
    return r.data
  },

  async replayAction(
    token: string | null,
    tenantId: string | null,
    action: string,
    payload: object,
  ): Promise<unknown> {
    if (action === 'record_pod')
      return this.recordPOD(token, tenantId, payload as Record<string, unknown>)
    if (action === 'driver_location')
      return this.updateDriverLocation(
        token,
        tenantId,
        payload as { lat: number; lng: number; timestamp: string; routeId?: string },
      )
    return Promise.resolve()
  },

  async markDelivered(
    routeId: string,
    stopId: string,
    pod: { recipient?: string; signature?: string } | Record<string, unknown>,
  ) {
    return client.post(
      `/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/delivered`,
      pod,
    )
  },

  async failDelivery(routeId: string, stopId: string, reason: string) {
    return client.post(`/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/failed`, {
      reason,
    })
  },
}
