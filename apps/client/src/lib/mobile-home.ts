/** Where each role starts in the mobile app, and which tabs it sees (PLR-171). */

export type MobileTab = { href: string; label: string; permission?: string; roles: string[] }

const MANAGERS = ['SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER']

export const FIELD_TABS: MobileTab[] = [
  { href: '/m/warehouse', label: 'Warehouse', permission: 'wms.read', roles: [...MANAGERS, 'WAREHOUSE_STAFF', 'OPS_STAFF'] },
  { href: '/m/delivery', label: 'Delivery', permission: 'dispatch.read', roles: [...MANAGERS, 'DRIVER', 'OPS_STAFF'] },
  { href: '/m/sales', label: 'Sales', permission: 'crm.read', roles: [...MANAGERS, 'SALES_REP', 'OPS_STAFF'] },
]

export const HOME_TAB: MobileTab = { href: '/m/home', label: 'Home', roles: [] }

const FIELD_HOME: Record<string, string> = {
  DRIVER: '/m/delivery',
  WAREHOUSE_STAFF: '/m/warehouse',
  SALES_REP: '/m/sales',
}

/** Field roles open their own work; everyone else (managers, accounting, viewers) opens Home. */
export function homeFor(role: string | undefined | null): string {
  return FIELD_HOME[(role ?? '').toUpperCase()] ?? '/m/home'
}

export function isManager(role: string | undefined | null): boolean {
  return MANAGERS.includes((role ?? '').toUpperCase())
}

/**
 * Tabs for a user. A field role sees only its own area plus what its permissions grant;
 * managers see every area and Home; other roles see Home only, so nobody lands on a screen
 * that answers 403.
 */
export function tabsFor(role: string | undefined | null, permissions: readonly string[] = []): MobileTab[] {
  const r = (role ?? '').toUpperCase()
  const wildcard = permissions.includes('*')
  const field = FIELD_TABS.filter((t) => wildcard || t.roles.includes(r) || (!!t.permission && permissions.includes(t.permission)))
  const showHome = isManager(r) || !(r in FIELD_HOME)
  return showHome ? [HOME_TAB, ...field] : field
}
