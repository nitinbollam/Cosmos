import axios, { AxiosInstance } from 'axios'

function token(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem('cosmos.accessToken')
}

/** Prefer same-origin `/api/v1` (Next rewrite → gateway). Override for direct gateway access if needed. */
export const gatewayApiBaseUrl = process.env.NEXT_PUBLIC_GATEWAY_URL ?? '/api/v1'

const baseURL = gatewayApiBaseUrl

/** User-facing hint when axios reports Network Error (gateway down / wrong URL). */
export function formatApiReachabilityError(err: unknown): string {
  const raw =
    err != null && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : 'Request failed'
  const lower = raw.toLowerCase()
  const unreachable =
    raw === 'Network Error' ||
    lower.includes('econnrefused') ||
    lower.includes('err_connection_refused') ||
    lower.includes('failed to fetch')
  if (unreachable) {
    const hint =
      gatewayApiBaseUrl.startsWith('/')
        ? 'Ensure pnpm dev is running (gateway on port 3000, web-admin on 4000).'
        : `From the repo root, run pnpm infra:up (Docker), copy .env from .env.example, run pnpm db:migrate, then pnpm dev so gateway-service listens on port 3000.`
    return `Cannot reach the API at ${gatewayApiBaseUrl}. ${hint}`
  }
  return raw
}

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
  routes: 'dispatch',
  reports: 'ledger',
}

function buildProxiedRelativePath(original: string): string {
  const normalized = original.startsWith('/') ? original.slice(1) : original
  if (normalized.startsWith('_proxy/')) return normalized
  const qIndex = normalized.indexOf('?')
  const pathname = qIndex >= 0 ? normalized.slice(0, qIndex) : normalized
  const query = qIndex >= 0 ? normalized.slice(qIndex) : ''
  const first = pathname.split('/').filter(Boolean)[0] ?? ''

  if (first === 'webhooks') {
    return `${pathname}${query}`
  }

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
  if (t) {
    cfg.headers = cfg.headers ?? {}
    cfg.headers.Authorization = `Bearer ${t}`
  }
  if (typeof cfg.url === 'string') {
    cfg.url = buildProxiedRelativePath(cfg.url)
  }
  return cfg
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (typeof window !== 'undefined' && err?.response?.status === 401) {
      window.localStorage.removeItem('cosmos.accessToken')
      window.localStorage.removeItem('cosmos.refreshToken')
      const path = window.location.pathname
      const next = path && path !== '/login' ? `?next=${encodeURIComponent(path)}` : ''
      if (path !== '/login') {
        window.location.assign(`/login${next}`)
      }
    }
    return Promise.reject(err)
  },
)

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
