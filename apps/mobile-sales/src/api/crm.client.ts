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
  contactName?: string | null
  email?: string | null
  status: string
  source?: string | null
  pipelineValue?: string | number | null
  assignedToUserId?: string | null
  customerId?: string | null
  createdAt: string
  updatedAt?: string
}

export interface CustomerDto {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  externalRef?: string | null
  customerKind?: string
  creditLimit?: string | null
  creditUsed?: string | number | null
  paymentTermsDays?: number
  salesRepUserId?: string | null
  primaryAddressLine1?: string | null
  primaryCity?: string | null
  primaryState?: string | null
  primaryZip?: string | null
  createdAt?: string
}

export type ActivityType = 'CALL' | 'EMAIL' | 'NOTE'

export interface ActivityDto {
  id: string
  type: ActivityType
  subject?: string | null
  body?: string | null
  outcome?: string | null
  customerId?: string | null
  leadId?: string | null
  occurredAt: string
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

  async convertLead(id: string, body: { customerName: string }) {
    const r = await client.post<unknown>(`/leads/${encodeURIComponent(id)}/convert`, body)
    return r.data
  },

  async createLead(body: {
    companyName: string
    email?: string
    contactName?: string
    source?: string
  }) {
    const r = await client.post<LeadDto>('/leads', body)
    return r.data
  },

  async listCustomers() {
    const r = await client.get<CustomerDto[]>('/customers')
    return r.data
  },

  async getCustomer(id: string) {
    const r = await client.get<CustomerDto>(`/customers/${encodeURIComponent(id)}`)
    return r.data
  },

  async listActivities(params?: { customerId?: string; leadId?: string }) {
    const sp = new URLSearchParams()
    if (params?.customerId) sp.set('customerId', params.customerId)
    if (params?.leadId) sp.set('leadId', params.leadId)
    const q = sp.toString()
    const r = await client.get<ActivityDto[]>(`/activities${q ? `?${q}` : ''}`)
    return r.data
  },

  async createActivity(body: {
    type: ActivityType
    subject?: string
    body?: string
    outcome?: string
    customerId?: string
    leadId?: string
  }) {
    const r = await client.post<ActivityDto>('/activities', body)
    return r.data
  },
}
