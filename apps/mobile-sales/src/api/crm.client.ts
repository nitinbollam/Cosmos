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

export interface LeadDto {
  id: string
  companyName: string
  email: string | null
  status: string
  createdAt: string
}

export interface CustomerDto {
  id: string
  name: string
  email: string | null
  phone: string | null
  externalRef: string | null
}

export const crmClient = {
  async login(email: string, password: string) {
    const r = await client.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
      email,
      password,
    })
    await SecureStore.setItemAsync('cosmos.accessToken', r.data.accessToken)
    await SecureStore.setItemAsync('cosmos.refreshToken', r.data.refreshToken)
    return r.data
  },

  async listLeads() {
    const r = await client.get<LeadDto[]>('/leads')
    return r.data
  },

  async listCustomers() {
    const r = await client.get<CustomerDto[]>('/customers')
    return r.data
  },

  async createLead(body: { companyName: string; email?: string }) {
    const r = await client.post<LeadDto>('/leads', body)
    return r.data
  },
}
