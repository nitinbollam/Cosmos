import axios, { AxiosInstance } from 'axios'

function token(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem('cosmos.accessToken')
}

const baseURL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000/api/v1'

/** First path segment → gateway `_proxy/:service/` key (must match ProxyService SERVICE_ENV_KEYS). */
const FIRST_TO_SERVICE: Record<string, string> = {
  analytics: 'analytics',
  kpi: 'analytics',
  tenants: 'tenant',
  tenant: 'tenant',
  inventory: 'inventory',
  orders: 'order',
  msa: 'compliance',
  tax: 'compliance',
  skus: 'inventory',
  warehouses: 'inventory',
  auth: 'auth',
  suppliers: 'purchasing',
  users: 'auth',
  'purchase-orders': 'purchasing',
  customers: 'crm',
  leads: 'crm',
  activities: 'crm',
  notifications: 'notification',
  'journal-entries': 'ledger',
  'chart-accounts': 'ledger',
  payments: 'payment',
  quotes: 'storefront',
  fulfillment: 'wms',
  wms: 'wms',
  sync: 'wms',
  dispatch: 'dispatch',
}

function buildProxiedRelativePath(original: string): string {
  const normalized = original.startsWith('/') ? original.slice(1) : original
  if (normalized.startsWith('_proxy/')) return normalized
  const qIndex = normalized.indexOf('?')
  const pathname = qIndex >= 0 ? normalized.slice(0, qIndex) : normalized
  const query = qIndex >= 0 ? normalized.slice(qIndex) : ''
  const first = pathname.split('/').filter(Boolean)[0] ?? ''

  let serviceKey = FIRST_TO_SERVICE[first]
  if (!serviceKey) {
    if (first.startsWith('purchase')) serviceKey = 'purchasing'
    else serviceKey = first || 'gateway'
  }

  return `_proxy/${serviceKey}/${pathname}${query}`
}

const client: AxiosInstance = axios.create({ baseURL, timeout: 25_000 })

client.interceptors.request.use((cfg) => {
  const t = token()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  if (typeof cfg.url === 'string') {
    cfg.url = buildProxiedRelativePath(cfg.url)
  }
  return cfg
})

export const api = {
  async get<T = unknown>(path: string): Promise<T> {
    const { data } = await client.get<T>(path)
    return data
  },
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const { data } = await client.post<T>(path, body)
    return data
  },
  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const { data } = await client.patch<T>(path, body)
    return data
  },
  async delete<T = unknown>(path: string): Promise<T> {
    const { data } = await client.delete<T>(path)
    return data
  },
}
