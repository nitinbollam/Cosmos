import axios from 'axios'
import * as SecureStore from 'expo-secure-store'
import { toGatewayProxyPath } from './gatewayPath'

const baseURL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000/api/v1'

const client = axios.create({ baseURL, timeout: 20_000 })

client.interceptors.request.use(async (cfg) => {
  const token = await SecureStore.getItemAsync('cosmos.accessToken')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  if (typeof cfg.url === 'string') {
    cfg.url = toGatewayProxyPath(cfg.url.startsWith('/') ? cfg.url.slice(1) : cfg.url)
  }
  return cfg
})

export const wmsClient = {
  async login(email: string, password: string) {
    const r = await client.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
      email,
      password,
    })
    await SecureStore.setItemAsync('cosmos.accessToken', r.data.accessToken)
    await SecureStore.setItemAsync('cosmos.refreshToken', r.data.refreshToken)
    return r.data
  },

  async listTasks(status = 'PENDING') {
    const r = await client.get(`/wms/tasks?status=${encodeURIComponent(status)}`)
    return r.data as Array<{
      id: string
      orderId: string
      status: string
      priority: string
      warehouseCode: string
      pickItems?: Array<{
        id: string
        skuId: string
        quantity: number
        pickedQty: number
        status: string
      }>
    }>
  },

  async getTask(taskId: string) {
    const r = await client.get(`/wms/tasks/${encodeURIComponent(taskId)}`)
    return r.data as {
      id: string
      orderId: string
      status: string
      correlationId: string
      warehouseId: string
      pickItems: Array<{
        id: string
        skuId: string
        warehouseId: string
        quantity: number
        pickedQty: number
        status: string
      }>
    }
  },

  /** Watermelon-compatible replay contract (routes through sync controller). */
  async replayAction(action: string, payload: unknown) {
    await client.post('/sync/replay', { action, payload })
  },

  async pullChanges(lastPulledAt: number | null) {
    return client.get(`/sync/pull?since=${lastPulledAt ?? 0}`)
  },

  async pushChanges(changes: unknown) {
    return client.post('/sync/push', { changes })
  },
}
