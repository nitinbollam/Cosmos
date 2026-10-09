import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

export const DEFAULT_GATEWAY_PATH = '/api/v1'

export type CreateGatewayApiOptions = {
  baseUrl?: string
  devWebPort?: number
  accessTokenStorageKey?: string
  refreshTokenStorageKey?: string
  loginPath?: string
  timeoutMs?: number
  /**
   * Returns the access token for the next request, refreshing it first when it is about to
   * expire. Defaults to reading `accessTokenStorageKey` from localStorage.
   */
  getAccessToken?: () => string | null | Promise<string | null>
  /**
   * Exchange the refresh token for a new access token after a 401.
   * Resolve the new token, resolve `null` when the session is definitely over, or throw on a
   * transient failure (offline, 503) so the user is NOT signed out.
   */
  refresh?: () => Promise<string | null>
  /** Called when the session is over (refresh impossible). Defaults to clearing tokens and redirecting to `loginPath`. */
  onUnauthorized?: () => void
}

/** Auth endpoints answer 401 for bad credentials; those must never trigger refresh or sign-out. */
const CREDENTIAL_ENDPOINTS =
  /\/auth\/(login|refresh|logout|signup|accept-invite|forgot-password|reset-password|verify-email|resend-verification|change-password)\b/

type RetriableConfig = InternalAxiosRequestConfig & { _plerosRetried?: boolean }

export function resolveGatewayBaseUrl(override?: string): string {
  if (override) return override
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GATEWAY_URL) {
    return process.env.NEXT_PUBLIC_GATEWAY_URL
  }
  if (typeof process !== 'undefined' && process.env.VITE_GATEWAY_URL) {
    return process.env.VITE_GATEWAY_URL
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
  const accessKey = options.accessTokenStorageKey ?? 'pleros.accessToken'
  const refreshKey = options.refreshTokenStorageKey ?? 'pleros.refreshToken'
  const loginPath = options.loginPath ?? '/login'

  function storedToken(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(accessKey)
  }

  function defaultUnauthorized() {
    window.localStorage.removeItem(accessKey)
    window.localStorage.removeItem(refreshKey)
    const path = window.location.pathname
    if (path !== loginPath) {
      const next = path ? `?next=${encodeURIComponent(path)}` : ''
      window.location.assign(`${loginPath}${next}`)
    }
  }

  const client: AxiosInstance = axios.create({
    baseURL: gatewayApiBaseUrl,
    timeout: options.timeoutMs ?? 25_000,
  })

  client.interceptors.request.use(async (cfg) => {
    const t = options.getAccessToken ? await options.getAccessToken() : storedToken()
    if (t) {
      cfg.headers = cfg.headers ?? {}
      cfg.headers.Authorization = `Bearer ${t}`
    }
    return cfg
  })

  client.interceptors.response.use(
    (res) => res,
    async (err) => {
      const cfg = err?.config as RetriableConfig | undefined
      if (typeof window === 'undefined' || err?.response?.status !== 401 || !cfg) {
        return Promise.reject(err)
      }
      if (CREDENTIAL_ENDPOINTS.test(String(cfg.url ?? ''))) return Promise.reject(err)

      if (options.refresh && !cfg._plerosRetried) {
        let next: string | null
        try {
          next = await options.refresh()
        } catch {
          // Offline or the auth service is down: keep the session, surface the original error.
          return Promise.reject(err)
        }
        if (next) {
          cfg._plerosRetried = true
          cfg.headers.Authorization = `Bearer ${next}`
          return client.request(cfg)
        }
      }
      ;(options.onUnauthorized ?? defaultUnauthorized)()
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
