import type { SessionUser } from './session'
import { ApiError } from './session'

/** Coarse permission map — extend as modules grow. */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  TENANT_ADMIN: ['*'],
  MANAGER: [
    'orders.read',
    'orders.write',
    'inventory.read',
    'inventory.write',
    'finance.read',
    'crm.read',
    'crm.write',
    'dispatch.read',
    'dispatch.write',
  ],
  ACCOUNTANT: ['finance.read', 'finance.write', 'orders.read', 'purchasing.read'],
  WAREHOUSE_STAFF: ['inventory.read', 'inventory.write', 'orders.read', 'fulfillment.write'],
  DRIVER: ['dispatch.read', 'dispatch.write'],
  SALES_REP: ['crm.read', 'crm.write', 'orders.read', 'quotes.write'],
  STAFF: ['portal.catalog', 'portal.orders', 'portal.quotes', 'portal.invoices'],
  VIEWER: ['portal.catalog', 'portal.orders'],
}

export function permissionsForRole(role: string): string[] {
  return ROLE_PERMISSIONS[role] ?? []
}

export function hasPermission(session: SessionUser, permission: string): boolean {
  const perms = permissionsForRole(session.role)
  return perms.includes('*') || perms.includes(permission)
}

export function assertPermission(session: SessionUser, permission: string) {
  if (!hasPermission(session, permission)) {
    throw new ApiError(403, `Missing permission: ${permission}`)
  }
}
