import axios from 'axios'
import * as SecureStore from 'expo-secure-store'
import { toGatewayProxyPath } from './gatewayPath'

const baseURL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000/api/v1'

const client = axios.create({ baseURL, timeout: 20_000 })

client.interceptors.request.use(async (cfg) => {
  const token = await SecureStore.getItemAsync('cosmos.accessToken')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  if (typeof cfg.url === 'string')
    cfg.url = toGatewayProxyPath(cfg.url.startsWith('/') ? cfg.url.slice(1) : cfg.url)
  return cfg
})

export const dispatchClient = {
  async login(email: string, password: string) {
    const r = await client.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
      email,
      password,
    })
    await SecureStore.setItemAsync('cosmos.accessToken', r.data.accessToken)
    await SecureStore.setItemAsync('cosmos.refreshToken', r.data.refreshToken)
    return r.data
  },

  /** Best-effort location ping when backend exposes a route (optional). */
  async updateDriverLocation(lat: number, lng: number) {
    await client.post('/routes/telemetry/location', { lat, lng, at: new Date().toISOString() }).catch(() => undefined)
  },

  async markDelivered(
    routeId: string,
    stopId: string,
    pod: { recipient?: string; signature?: string } | Record<string, unknown>,
  ) {
    return client.post(`/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/delivered`, pod)
  },

  async failDelivery(routeId: string, stopId: string, reason: string) {
    return client.post(`/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/failed`, {
      reason,
    })
  },
}
