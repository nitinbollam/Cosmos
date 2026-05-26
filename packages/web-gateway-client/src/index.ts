import axios, { AxiosInstance } from 'axios'

export const DEFAULT_GATEWAY_PATH = '/api/v1'

export type CreateGatewayApiOptions = {
  baseUrl?: string
  devWebPort?: number
  accessTokenStorageKey?: string
  refreshTokenStorageKey?: string
  loginPath?: string
  timeoutMs?: number
}

export function resolveGatewayBaseUrl(override?: string): string {
  if (override) return override
  try {
    const env = (import.meta as ImportMeta & { env?: { VITE_GATEWAY_URL?: string } }).env
    if (env?.VITE_GATEWAY_URL) return env.VITE_GATEWAY_URL
  } catch {
    /* not a Vite bundle */
  }
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GATEWAY_URL) {
    return process.env.NEXT_PUBLIC_GATEWAY_URL
  }
  return DEFAULT_GATEWAY_PATH
}

export function formatApiReachabilityError(
  err: unknown,
  gatewayApiBaseUrl: string,
  devWebPort?: number,
): string {
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
    const hint = gatewayApiBaseUrl.startsWith('/')
      ? `Ensure npm run dev is running on port ${devWebPort ?? 4000}.`
      : 'Run npm run db:setup, npm run db:migrate, npm run seed, then npm run dev.'
    return `Cannot reach the API at ${gatewayApiBaseUrl}. ${hint}`
  }
  return raw
}

export type GatewayApi = {
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => Promise<T>
  patch: <T>(path: string, body?: unknown) => Promise<T>
  delete: <T>(path: string) => Promise<T>
}

export function createGatewayApi(options: CreateGatewayApiOptions = {}): {
  api: GatewayApi
  gatewayApiBaseUrl: string
  formatApiReachabilityError: (err: unknown) => string
  client: AxiosInstance
} {
  const gatewayApiBaseUrl = resolveGatewayBaseUrl(options.baseUrl)
  const accessKey = options.accessTokenStorageKey ?? 'cosmos.accessToken'
  const refreshKey = options.refreshTokenStorageKey ?? 'cosmos.refreshToken'
  const loginPath = options.loginPath ?? '/login'

  function token(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(accessKey)
  }

  const client: AxiosInstance = axios.create({
    baseURL: gatewayApiBaseUrl,
    timeout: options.timeoutMs ?? 25_000,
  })

  client.interceptors.request.use((cfg) => {
    const t = token()
    if (t) {
      cfg.headers = cfg.headers ?? {}
      cfg.headers.Authorization = `Bearer ${t}`
    }
    return cfg
  })

  client.interceptors.response.use(
    (res) => res,
    (err) => {
      if (typeof window !== 'undefined' && err?.response?.status === 401) {
        window.localStorage.removeItem(accessKey)
        window.localStorage.removeItem(refreshKey)
        const path = window.location.pathname
        const next = path && path !== loginPath ? `?next=${encodeURIComponent(path)}` : ''
        if (path !== loginPath) {
          window.location.assign(`${loginPath}${next}`)
        }
      }
      return Promise.reject(err)
    },
  )

  const api: GatewayApi = {
    get: <T>(path: string) => client.get<T>(path).then((r) => r.data),
    post: <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
      client.post<T>(path, body, headers ? { headers } : undefined).then((r) => r.data),
    patch: <T>(path: string, body?: unknown) => client.patch<T>(path, body).then((r) => r.data),
    delete: <T>(path: string) => client.delete<T>(path).then((r) => r.data),
  }

  return {
    api,
    gatewayApiBaseUrl,
    formatApiReachabilityError: (err) => formatApiReachabilityError(err, gatewayApiBaseUrl, options.devWebPort),
    client,
  }
}
