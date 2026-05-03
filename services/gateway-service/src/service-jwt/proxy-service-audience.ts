/** Maps `_proxy/:serviceKey` segment to downstream `SERVICE_NAME` / JWT `aud` value. */
export const PROXY_SERVICE_KEY_TO_AUDIENCE: Record<string, string> = {
  auth: 'auth-service',
  tenant: 'tenant-service',
  inventory: 'inventory-service',
  wms: 'wms-service',
  order: 'order-service',
  purchasing: 'purchasing-service',
  compliance: 'compliance-service',
  storefront: 'storefront-service',
  pos: 'pos-service',
  crm: 'crm-service',
  dispatch: 'dispatch-service',
  payment: 'payment-service',
  ledger: 'ledger-service',
  analytics: 'analytics-service',
  notification: 'notification-service',
}

export function audienceForProxyServiceKey(serviceKey: string): string | null {
  return PROXY_SERVICE_KEY_TO_AUDIENCE[serviceKey.toLowerCase()] ?? null
}
