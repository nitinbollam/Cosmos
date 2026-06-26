import { createGatewayApi, DEFAULT_GATEWAY_PATH } from '@pleros/web-gateway-client'

const { api, gatewayApiBaseUrl, formatApiReachabilityError } = createGatewayApi({
  baseUrl: import.meta.env.VITE_GATEWAY_URL ?? DEFAULT_GATEWAY_PATH,
  devWebPort: 4000,
  loginPath: '/admin/login',
})

export { api, api as adminApi, gatewayApiBaseUrl, formatApiReachabilityError }
