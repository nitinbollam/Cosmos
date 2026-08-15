// Shared cross-service domain types.

export type UUID = string
export type ISODate = string

export type Role =
  | 'SUPER_ADMIN'
  | 'TENANT_ADMIN'
  | 'MANAGER'
  | 'WAREHOUSE_STAFF'
  | 'SALES_REP'
  | 'DRIVER'
  | 'ACCOUNTANT'
  | 'VIEWER'
  | 'STAFF'

export type Plan = 'STARTER' | 'GROWTH' | 'ENTERPRISE'

export interface JwtPayload {
  sub: string
  email: string
  role: Role
  tenantId: string
  permissions?: string[]
  iat?: number
  exp?: number
}

export interface AuthenticatedUser {
  userId: string
  email: string
  role: Role
  tenantId: string
  permissions: string[]
}

export interface UserSummary {
  id: string
  email: string
  firstName: string
  lastName: string
  role: Role
  permissions: string[]
  isActive: boolean
  lastLoginAt?: string | null
  createdAt: string
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface MoneyAmount {
  amount: number
  currency: string
}

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'BACKORDERED'
  | 'PROCESSING'
  | 'PACKED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'RETURNED'

export type OrderChannel = 'POS' | 'B2B_PORTAL' | 'SALES_REP' | 'API' | 'EDI'

export type PaymentMethod = 'CARD' | 'ACH' | 'CHECK' | 'CASH' | 'NET_TERMS'

export type ReservationStatus = 'ACTIVE' | 'FULFILLED' | 'RELEASED' | 'EXPIRED'

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  service: string
  version: string
  uptimeSec: number
  checks: Record<string, { status: 'pass' | 'warn' | 'fail'; detail?: string }>
}

export interface ApiError {
  code: string
  message: string
  statusCode: number
  correlationId?: string
  details?: Record<string, unknown>
}
