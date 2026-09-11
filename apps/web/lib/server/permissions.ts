import type { SessionUser } from './session'
import { ApiError } from './session'

export const AVAILABLE_MODULES = [
  'orders',
  'inventory',
  'wms',
  'purchasing',
  'compliance',
  'crm',
  'quotes',
  'dispatch',
  'finance',
  'reports',
  'pos',
  'notifications',
  'settings',
  'users',
  'audit',
  'edi',
  'celestial',
  'marketplace',
] as const

export type ModuleKey = (typeof AVAILABLE_MODULES)[number]

export const MODULE_METADATA: Record<ModuleKey, { label: string; permissions: string[] }> = {
  orders: { label: 'Orders', permissions: ['orders.read', 'orders.write'] },
  inventory: { label: 'Inventory', permissions: ['inventory.read', 'inventory.write'] },
  wms: { label: 'Warehouse & Fulfillment', permissions: ['wms.read', 'wms.write'] },
  purchasing: { label: 'Purchasing', permissions: ['purchasing.read', 'purchasing.write'] },
  compliance: { label: 'Compliance & Tax', permissions: ['compliance.read', 'compliance.write'] },
  crm: { label: 'CRM & Customers', permissions: ['crm.read', 'crm.write'] },
  quotes: { label: 'Quotes', permissions: ['quotes.read', 'quotes.write'] },
  dispatch: { label: 'Dispatch & Delivery', permissions: ['dispatch.read', 'dispatch.write'] },
  finance: { label: 'Finance & Ledger', permissions: ['finance.read', 'finance.write'] },
  reports: { label: 'Reports & Analytics', permissions: ['reports.read', 'reports.write'] },
  pos: { label: 'Point of Sale', permissions: ['pos.read', 'pos.write'] },
  notifications: { label: 'Notifications', permissions: ['notifications.read', 'notifications.write'] },
  settings: { label: 'Company Settings', permissions: ['settings.read', 'settings.write'] },
  users: { label: 'User Management', permissions: ['users.read', 'users.write'] },
  audit: { label: 'Audit Log', permissions: ['audit.read'] },
  edi: { label: 'EDI Integration', permissions: ['edi.read', 'edi.write'] },
  celestial: { label: 'Celestial AI', permissions: ['celestial.chat'] },
  marketplace: { label: 'Marketplace', permissions: ['marketplace.read', 'marketplace.write'] },
}

/** Standard role default permission matrices. */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  TENANT_ADMIN: ['*'],
  MANAGER: [
    'orders.*',
    'inventory.*',
    'wms.*',
    'purchasing.*',
    'compliance.*',
    'crm.*',
    'quotes.*',
    'dispatch.*',
    'finance.*',
    'reports.*',
    'pos.*',
    'notifications.*',
    'celestial.chat',
    'marketplace.*',
    'settings.read',
    'audit.read',
    'users.read',
    'edi.read',
  ],
  ACCOUNTANT: [
    'finance.*',
    'orders.read',
    'purchasing.read',
    'reports.*',
    'inventory.read',
    'compliance.*',
    'notifications.read',
    'celestial.chat',
    'audit.read',
  ],
  WAREHOUSE_STAFF: [
    'inventory.*',
    'wms.*',
    'orders.read',
    'purchasing.read',
    'notifications.read',
    'celestial.chat',
  ],
  DRIVER: [
    'dispatch.*',
    'orders.read',
    'notifications.read',
  ],
  SALES_REP: [
    'crm.*',
    'quotes.*',
    'orders.*',
    'inventory.read',
    'pos.*',
    'reports.read',
    'notifications.read',
    'celestial.chat',
    'marketplace.read',
    'marketplace.write',
  ],
  STAFF: [
    'portal.catalog',
    'portal.orders',
    'portal.quotes',
    'portal.invoices',
  ],
  VIEWER: [
    'portal.catalog',
    'portal.orders',
    'orders.read',
    'reports.read',
  ],
}

export function permissionsForRole(role: string): string[] {
  return ROLE_PERMISSIONS[role] ?? []
}

/**
 * Checks if a session has the requested permission.
 * - SUPER_ADMIN and TENANT_ADMIN always have full access (`*`).
 * - Custom session permissions take precedence if non-empty; otherwise role defaults apply.
 * - Supports exact matches (`orders.read`), module wildcards (`orders.*`), and global wildcard (`*`).
 */
export function hasPermission(session: SessionUser | null | undefined, permission: string): boolean {
  if (!session) return false
  if (session.role === 'SUPER_ADMIN' || session.role === 'TENANT_ADMIN') return true

  const perms =
    Array.isArray(session.permissions) && session.permissions.length > 0
      ? session.permissions
      : permissionsForRole(session.role)

  if (perms.includes('*')) return true
  if (perms.includes(permission)) return true

  const [mod] = permission.split('.')
  if (mod && perms.includes(`${mod}.*`)) return true

  // Cross-module compatibility aliases for warehouse / inventory
  if (permission === 'wms.read' && (perms.includes('inventory.read') || perms.includes('inventory.*'))) return true
  if (permission === 'inventory.read' && perms.includes('wms.*')) return true

  return false
}

export function assertPermission(session: SessionUser, permission: string | string[]) {
  const checkList = Array.isArray(permission) ? permission : [permission]
  const ok = checkList.some((p) => hasPermission(session, p))
  if (!ok) {
    throw new ApiError(403, `Forbidden: missing permission ${checkList.join(' or ')}`)
  }
}

export async function requirePermission(req: Request, permission: string | string[]): Promise<SessionUser> {
  const { requireSession } = await import('./session')
  const session = await requireSession(req)
  assertPermission(session, permission)
  return session
}

export function filterAuthorizedModules(session: SessionUser | null | undefined): ModuleKey[] {
  if (!session) return []
  return AVAILABLE_MODULES.filter(
    (mod) =>
      hasPermission(session, `${mod}.read`) ||
      hasPermission(session, `${mod}.write`) ||
      hasPermission(session, `${mod}.*`) ||
      hasPermission(session, '*'),
  )
}

