import axios, { type InternalAxiosRequestConfig } from 'axios'
import * as SecureStore from 'expo-secure-store'
import { toGatewayProxyPath } from './gatewayPath'

const baseURL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000/api/v1'

const client = axios.create({ baseURL, timeout: 25_000 })

client.interceptors.request.use(async (cfg: InternalAxiosRequestConfig) => {
  const token = await SecureStore.getItemAsync('cosmos.accessToken')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  if (typeof cfg.url === 'string') {
    cfg.url = toGatewayProxyPath(cfg.url.startsWith('/') ? cfg.url.slice(1) : cfg.url)
  }
  return cfg
})

export interface SkuRow {
  id: string
  code: string
  name: string
  description?: string | null
  category: string
  price: string | number
  cost?: string | number
  isActive?: boolean
  quantityOnHand?: number
  quantityAvailable?: number
}

export interface SkuListResponse {
  items: SkuRow[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface WarehouseRow {
  id: string
  name: string
  code?: string | null
}

export const inventoryClient = {
  async searchSkus(q: string, pageSize = 30) {
    const term = encodeURIComponent(q.trim() || '')
    const r = await client.get<SkuListResponse>(
      `/skus?page=1&pageSize=${pageSize}${term ? `&search=${term}` : ''}`,
    )
    return r.data
  },

  async listWarehouses() {
    const r = await client.get<WarehouseRow[]>('/warehouses')
    return r.data
  },
}
