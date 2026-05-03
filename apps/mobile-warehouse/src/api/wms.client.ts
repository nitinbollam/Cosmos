import axios from 'axios'
import * as SecureStore from 'expo-secure-store'
import { toGatewayProxyPath } from './gatewayPath'

const baseURL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000/api/v1'

const client = axios.create({ baseURL, timeout: 20_000 })

client.interceptors.request.use(async (cfg) => {
  const token = await SecureStore.getItemAsync('cosmos.accessToken')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  const tenantId = await SecureStore.getItemAsync('cosmos.tenantId')
  if (tenantId) cfg.headers['x-cosmos-tenant-id'] = tenantId
  if (typeof cfg.url === 'string') {
    cfg.url = toGatewayProxyPath(cfg.url.startsWith('/') ? cfg.url.slice(1) : cfg.url)
  }
  return cfg
})

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

export const wmsClient = {
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

  async getWarehouses(token?: string | null, tenantId?: string | null) {
    const r = await client.get('/inventory/warehouses', {
      headers: await optionalAuthHeaders(token, tenantId),
    })
    const d = r.data as { data?: Array<{ id: string; name: string }> }
    return (d?.data ?? r.data) as Array<{ id: string; name: string }>
  },

  async startReceivingSession(
    token?: string | null,
    tenantId?: string | null,
    body?: { warehouseId: string; poId?: string },
  ) {
    const r = await client.post('/wms/receiving/sessions', body ?? {}, {
      headers: await optionalAuthHeaders(token, tenantId),
    })
    return r.data as { id: string; poId?: string | null }
  },

  async getReceivingSession(
    token?: string | null,
    tenantId?: string | null,
    sessionId?: string,
  ) {
    const r = await client.get(`/wms/receiving/sessions/${encodeURIComponent(sessionId ?? '')}`, {
      headers: await optionalAuthHeaders(token, tenantId),
    })
    return r.data
  },

  async scanReceivingItem(
    token?: string | null,
    tenantId?: string | null,
    sessionId?: string,
    body?: { barcode: string; receivedQty: number; damagedQty?: number },
  ) {
    const r = await client.post(
      `/wms/receiving/sessions/${encodeURIComponent(sessionId ?? '')}/scan`,
      body ?? {},
      { headers: await optionalAuthHeaders(token, tenantId) },
    )
    return r.data
  },

  async completeReceivingSession(
    token?: string | null,
    tenantId?: string | null,
    sessionId?: string,
    notes?: string,
  ) {
    const r = await client.patch(
      `/wms/receiving/sessions/${encodeURIComponent(sessionId ?? '')}/complete`,
      { notes },
      { headers: await optionalAuthHeaders(token, tenantId) },
    )
    return r.data
  },

  async listTasks(status = 'PENDING') {
    const r = await client.get(`/wms/tasks?status=${encodeURIComponent(status)}`)
    return r.data as Array<{
      id: string
      orderId: string
      status: string
      priority: string
      warehouseCode: string
      pickItems?: Array<{
        id: string
        skuId: string
        quantity: number
        pickedQty: number
        status: string
      }>
    }>
  },

  async getTask(taskId: string) {
    const r = await client.get(`/wms/tasks/${encodeURIComponent(taskId)}`)
    return r.data as {
      id: string
      orderId: string
      status: string
      correlationId: string
      warehouseId: string
      pickItems: Array<{
        id: string
        skuId: string
        warehouseId: string
        quantity: number
        pickedQty: number
        status: string
      }>
    }
  },

  /** Watermelon-compatible replay contract (routes through sync controller). */
  async replayAction(action: string, payload: unknown) {
    await client.post('/sync/replay', { action, payload })
  },

  async pullChanges(lastPulledAt: number | null) {
    return client.get(`/sync/pull?since=${lastPulledAt ?? 0}`)
  },

  async pushChanges(changes: unknown) {
    return client.post('/sync/push', { changes })
  },
}
