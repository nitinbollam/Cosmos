import { createGatewayApi, DEFAULT_GATEWAY_PATH } from '@pleros/web-gateway-client'
import { getFreshAccessToken, handleSessionExpired, refreshTokens } from '@/lib/auth-session'

const { api, gatewayApiBaseUrl, formatApiReachabilityError } = createGatewayApi({
  baseUrl: import.meta.env.VITE_GATEWAY_URL ?? DEFAULT_GATEWAY_PATH,
  devWebPort: 4000,
  loginPath: '/login',
  // Follows the login of the area the current page belongs to.
  getAccessToken: () => getFreshAccessToken(),
  refresh: () => refreshTokens(),
  onUnauthorized: () => handleSessionExpired(),
})

export { api, gatewayApiBaseUrl, formatApiReachabilityError }
