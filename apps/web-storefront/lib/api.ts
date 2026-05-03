import axios, { AxiosInstance } from 'axios'

function token(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem('cosmos.accessToken')
}

const baseURL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000/api/v1'

const FIRST: Record<string, string> = {
  analytics: 'analytics',
  tenants: 'tenant',
  quotes: 'storefront',
  auth: 'auth',
  orders: 'order',
}

function buildProxiedPath(original: string): string {
  const normalized = original.startsWith('/') ? original.slice(1) : original
  if (normalized.startsWith('_proxy/')) return normalized
  const qi = normalized.indexOf('?')
  const pathname = qi >= 0 ? normalized.slice(0, qi) : normalized
  const query = qi >= 0 ? normalized.slice(qi) : ''
  const seg = pathname.split('/').filter(Boolean)[0] ?? ''
  const svc = FIRST[seg] ?? seg
  return `_proxy/${svc}/${pathname}${query}`
}

const client: AxiosInstance = axios.create({ baseURL, timeout: 25_000 })
client.interceptors.request.use((cfg) => {
  const t = token()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  if (typeof cfg.url === 'string') cfg.url = buildProxiedPath(cfg.url)
  return cfg
})

export const api = {
  get: <T,>(path: string) => client.get<T>(path).then((r) => r.data),
  post: <T,>(path: string, body?: unknown) =>
    client.post<T>(path, body).then((r) => r.data),
}
