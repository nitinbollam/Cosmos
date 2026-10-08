import { createGatewayApi, DEFAULT_GATEWAY_PATH } from '@pleros/web-gateway-client'
import { getFreshAccessToken, handleSessionExpired, refreshTokens } from '@/lib/auth-session'

const { api, gatewayApiBaseUrl, formatApiReachabilityError } = createGatewayApi({
  baseUrl: import.meta.env.VITE_GATEWAY_URL ?? DEFAULT_GATEWAY_PATH,
  devWebPort: 4000,
  loginPath: '/m/login',
  // Bound to the mobile login regardless of which page calls it.
  getAccessToken: () => getFreshAccessToken('mobile'),
  refresh: () => refreshTokens('mobile'),
  onUnauthorized: () => handleSessionExpired('mobile'),
})

export { api, gatewayApiBaseUrl, formatApiReachabilityError }
