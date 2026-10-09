import { createGatewayApi, DEFAULT_GATEWAY_PATH } from '@pleros/web-gateway-client'
import { getFreshAccessToken, handleSessionExpired, refreshTokens } from '@/lib/auth-session'

const { api, gatewayApiBaseUrl, formatApiReachabilityError } = createGatewayApi({
  baseUrl: import.meta.env.VITE_GATEWAY_URL ?? DEFAULT_GATEWAY_PATH,
  devWebPort: 4000,
  loginPath: '/admin/login',
  // Follows the login of the area the current page belongs to: this client is also used by
  // /marketplace and shared components, not only /admin.
  getAccessToken: () => getFreshAccessToken(),
  refresh: () => refreshTokens(),
  onUnauthorized: () => handleSessionExpired(),
})

export { api, api as adminApi, gatewayApiBaseUrl, formatApiReachabilityError }
