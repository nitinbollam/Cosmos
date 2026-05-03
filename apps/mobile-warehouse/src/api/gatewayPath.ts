/**
 * Rewrite relative paths for calls through cosmos gateway (`/api/v1/_proxy/:svc/...`).
 * Keep in sync loosely with apps/web-admin/lib/api.ts mapping.
 */
const FIRST: Record<string, string> = {
  analytics: 'analytics',
  kpi: 'analytics',
  tenants: 'tenant',
  inventory: 'inventory',
  orders: 'order',
  msa: 'compliance',
  tax: 'compliance',
  skus: 'inventory',
  warehouses: 'inventory',
  auth: 'auth',
  users: 'auth',
  suppliers: 'purchasing',
  'purchase-orders': 'purchasing',
  customers: 'crm',
  wms: 'wms',
  sync: 'wms',
  fulfillment: 'wms',
  routes: 'dispatch',
}

export function toGatewayProxyPath(original: string): string {
  const rel = original.startsWith('/') ? original.slice(1) : original
  if (rel.startsWith('_proxy/')) return rel
  const q = rel.indexOf('?')
  const path = q >= 0 ? rel.slice(0, q) : rel
  const query = q >= 0 ? rel.slice(q) : ''
  const first = path.split('/').filter(Boolean)[0] ?? ''
  let key = FIRST[first]
  if (!key) {
    if (first.startsWith('purchase')) key = 'purchasing'
    else key = first
  }
  return `_proxy/${key}/${path}${query}`
}
