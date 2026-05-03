/** Gateway `_proxy/:svc/…` rewriting for mobile Axios clients. */

const FIRST: Record<string, string> = {
  analytics: 'analytics',
  kpi: 'analytics',
  auth: 'auth',
  tenants: 'tenant',
  routes: 'dispatch',
  dispatch: 'dispatch',
  orders: 'order',
}

export function toGatewayProxyPath(original: string): string {
  const rel = original.startsWith('/') ? original.slice(1) : original
  if (rel.startsWith('_proxy/')) return rel
  const q = rel.indexOf('?')
  const path = q >= 0 ? rel.slice(0, q) : rel
  const query = q >= 0 ? rel.slice(q) : ''
  const first = path.split('/').filter(Boolean)[0] ?? ''
  const key = FIRST[first] ?? first
  return `_proxy/${key}/${path}${query}`
}
