export type TenantMe = {
  id: string
  slug: string
  displayName: string
  plan: string
  industry?: string
  timeZone: string
  billingEmail?: string | null
  suspended: boolean
  onboardingSteps?: Array<{ stepKey: string; completed: boolean }>
}

export type UserRow = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  permissions?: string[] | null
  isActive: boolean
  lastLoginAt?: string | null
  createdAt?: string
}

export type UsersPage = { items: UserRow[]; total: number; page: number; pageSize: number }

export type InviteRow = {
  id: string
  email: string
  role: string
  expiresAt: string
  createdAt: string
}

export type WarehouseRow = {
  id: string
  name: string
  code: string
  address: Record<string, unknown>
  isActive: boolean
  isDefault: boolean
}

export type MsaConfig = {
  id: string
  tenantId: string
  reporterDid: string
  msaEnabled: boolean
  manufacturerDids: Array<{
    id: string
    manufacturerDid: string
    manufacturerName: string
    ediEndpoint?: string | null
    autoSubmit: boolean
    isActive: boolean
  }>
} | null

export type StripeStatus = {
  secretKeyConfigured?: boolean
  webhookSigningSecretConfigured: boolean
  connectWebhookSigningSecretConfigured?: boolean
  rotation: string
}

export type NotificationProviderStatus = {
  email: { provider: string; configured: boolean; fromEmail: string }
  sms: { provider: string; configured: boolean; fromNumberMasked: string | null }
  webhook: { configured: boolean }
  activeFallback: string
  setupNote: string
}

export type TabId = 'company' | 'users' | 'warehouses' | 'integrations' | 'billing' | 'features' | 'audit'

export const STEP_LABELS: Record<string, string> = {
  ORG_PROFILE: 'Organization profile',
  BILLING_CONTACT: 'Billing contact',
  FIRST_WAREHOUSE: 'First warehouse',
  COMPLIANCE_ACK: 'Compliance acknowledgement',
}

export const INVITE_ROLES = [
  'STAFF',
  'VIEWER',
  'MANAGER',
  'WAREHOUSE_STAFF',
  'SALES_REP',
  'DRIVER',
  'ACCOUNTANT',
  'TENANT_ADMIN',
] as const

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}
