import axios, { type InternalAxiosRequestConfig } from 'axios'
import * as SecureStore from 'expo-secure-store'
import { toGatewayProxyPath } from './gatewayPath'

const baseURL = process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://localhost:3000/api/v1'

const client = axios.create({ baseURL, timeout: 30_000 })

client.interceptors.request.use(async (cfg: InternalAxiosRequestConfig) => {
  const token = await SecureStore.getItemAsync('cosmos.accessToken')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  if (typeof cfg.url === 'string') {
    cfg.url = toGatewayProxyPath(cfg.url.startsWith('/') ? cfg.url.slice(1) : cfg.url)
  }
  return cfg
})

export type OrderChannel = 'POS' | 'B2B_PORTAL' | 'SALES_REP' | 'API'
export type PaymentMethod = 'CARD' | 'ACH' | 'CHECK' | 'CASH' | 'NET_TERMS'

export interface OrderLineItemDto {
  skuId: string
  warehouseId: string
  quantity: number
  unitPrice: number
}

export interface CreateOrderBody {
  customerId: string
  channel: OrderChannel
  paymentMethod: PaymentMethod
  lineItems: OrderLineItemDto[]
  salesRepId?: string
  notes?: string
}

export interface OrderLine {
  id: string
  skuId: string
  warehouseId: string
  quantity: number
  unitPrice: string | number
}

export interface OrderSummaryDto {
  id: string
  customerId: string
  status: string
  channel: string
  paymentMethod: string
  totalAmount: string | number
  createdAt: string
  lineItems?: OrderLine[]
}

export interface OrderListResponse {
  items: OrderSummaryDto[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export const orderClient = {
  async listForCustomer(customerId: string, pageSize = 10) {
    const r = await client.get<OrderListResponse>(
      `/orders?customerId=${encodeURIComponent(customerId)}&page=1&pageSize=${pageSize}`,
    )
    return r.data
  },

  async create(body: CreateOrderBody, idempotencyKey: string) {
    const r = await client.post<OrderSummaryDto>('/orders', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    return r.data
  },
}
