export type SidebarNavLink = {
  label: string
  href: string
}

export type SidebarNavSection = {
  id: string
  label: string
  items: SidebarNavLink[]
}

export type SidebarNavEntry =
  | { type: 'link'; label: string; href: string }
  | ({ type: 'section' } & SidebarNavSection)

export const SIDEBAR_NAV: SidebarNavEntry[] = [
  { type: 'link', label: 'Dashboard', href: '/admin' },
  {
    type: 'section',
    id: 'general',
    label: 'General',
    items: [
      { label: 'User', href: '/admin/general/users' },
      { label: 'Role', href: '/admin/general/roles' },
      { label: 'E-com Theme', href: '/admin/general/ecom-theme' },
      { label: 'Customer Facing Display', href: '/admin/general/customer-display' },
    ],
  },
  {
    type: 'section',
    id: 'product',
    label: 'Product',
    items: [
      { label: 'Category', href: '/admin/product/categories' },
      { label: 'Brand', href: '/admin/product/brands' },
      { label: 'Product', href: '/admin/product/products' },
      { label: 'Product Group', href: '/admin/product/groups' },
    ],
  },
  {
    type: 'section',
    id: 'purchase',
    label: 'Purchase',
    items: [
      { label: 'Supplier', href: '/admin/purchase/suppliers' },
      { label: 'Purchase Order', href: '/admin/purchase/orders' },
      { label: 'Purchase Receive', href: '/admin/purchase/receive' },
      { label: 'Purchase Return', href: '/admin/purchase/returns' },
      { label: 'Stock Transfer', href: '/admin/purchase/stock-transfer' },
      { label: 'Store Channel', href: '/admin/purchase/store-channels' },
    ],
  },
  {
    type: 'section',
    id: 'sales',
    label: 'Sales',
    items: [
      { label: 'Customer', href: '/admin/sales/customers' },
      { label: 'Customer Group', href: '/admin/sales/customer-groups' },
      { label: 'Sale Order', href: '/admin/sales/orders' },
      { label: 'Sales Return', href: '/admin/sales/returns' },
      { label: 'Receive Payment', href: '/admin/sales/receive-payment' },
      { label: 'Promotion', href: '/admin/sales/promotions' },
    ],
  },
  {
    type: 'section',
    id: 'reports',
    label: 'Reports',
    items: [
      { label: 'Sale Summary Report', href: '/admin/reports/sale-summary' },
      { label: 'Daily Summary Report', href: '/admin/reports/daily-summary' },
      { label: 'Payment Received Report', href: '/admin/reports/payment-received' },
    ],
  },
  {
    type: 'section',
    id: 'operations',
    label: 'Operations',
    items: [
      { label: 'Inventory', href: '/admin/inventory' },
      { label: 'Orders', href: '/admin/orders' },
      { label: 'Warehouse', href: '/admin/warehouse' },
      { label: 'Purchasing', href: '/admin/purchasing' },
      { label: 'Fulfillment', href: '/admin/fulfillment' },
      { label: 'CRM', href: '/admin/crm' },
      { label: 'Dispatch', href: '/admin/dispatch' },
      { label: 'Compliance', href: '/admin/compliance' },
      { label: 'Finance', href: '/admin/finance' },
      { label: 'Settings', href: '/admin/settings' },
      { label: 'Notifications', href: '/admin/notifications' },
    ],
  },
]

export function navHrefPath(href: string): string {
  return href.split('?')[0] ?? href
}

export function isNavActive(pathname: string, href: string): boolean {
  const path = navHrefPath(href)
  if (path === '/admin') return pathname === '/admin' || pathname === '/admin/'
  if (pathname === path) return true
  if (pathname.startsWith(`${path}/`)) return true
  if (path === '/admin/inventory' && pathname.startsWith('/admin/product/products')) return true
  if (path === '/admin/product/products' && pathname.startsWith('/admin/inventory')) return true
  if (path === '/admin/orders' && pathname.startsWith('/admin/sales/orders')) return true
  if (path === '/admin/sales/orders' && pathname.startsWith('/admin/orders')) return true
  if (path === '/admin/purchasing' && pathname.startsWith('/admin/purchase/orders')) return true
  if (path === '/admin/purchase/orders' && pathname.startsWith('/admin/purchasing')) return true
  if (path === '/admin/customers' && pathname.startsWith('/admin/sales/customers')) return true
  if (path === '/admin/sales/customers' && pathname.startsWith('/admin/customers')) return true
  return false
}

export function sectionHasActive(pathname: string, section: SidebarNavSection): boolean {
  return section.items.some((item) => isNavActive(pathname, item.href))
}

export function titleFromAdminPath(pathname: string): string {
  for (const entry of SIDEBAR_NAV) {
    if (entry.type === 'link' && isNavActive(pathname, entry.href)) return entry.label
    if (entry.type === 'section') {
      for (const item of entry.items) {
        if (isNavActive(pathname, item.href)) return item.label
      }
    }
  }
  const parts = pathname.split('/').filter(Boolean)
  const seg = parts[parts.length - 1] ?? 'Overview'
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ')
}
