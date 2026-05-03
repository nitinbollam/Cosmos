const TENANT = 'cosmos.tenantId'
const CUSTOMER = 'cosmos.customerId'

export function setB2bSession(tenantId: string, customerId: string) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(TENANT, tenantId)
  sessionStorage.setItem(CUSTOMER, customerId)
}

export function clearB2bSession() {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(TENANT)
  sessionStorage.removeItem(CUSTOMER)
}

export function getB2bCustomerId(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(CUSTOMER)
}

export function getB2bTenantId(): string | null {
  if (typeof window === 'undefined') return null
  return sessionStorage.getItem(TENANT)
}
