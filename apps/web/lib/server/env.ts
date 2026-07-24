export function jwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim()
  if (!s) throw new Error('JWT_SECRET is not configured')
  return s
}

export function jwtRefreshSecret(): string {
  return process.env.JWT_REFRESH_SECRET?.trim() || jwtSecret()
}

/** Build a Postgres URL for a logical Pleros database on the same host as `baseUrl` (production / scaled dev). */
export function databaseUrlForDb(baseUrl: string, dbName: string): string {
  try {
    const u = new URL(baseUrl)
    u.pathname = `/${dbName}`
    return u.toString()
  } catch {
    return `${baseUrl.replace(/\/[^/]*$/, '')}/${dbName}`
  }
}

export const WEB_DATABASE_ENV_KEYS = [
  'AUTH_DATABASE_URL',
  'TENANT_DATABASE_URL',
  'INVENTORY_DATABASE_URL',
  'ORDER_DATABASE_URL',
  'CRM_DATABASE_URL',
  'STOREFRONT_DATABASE_URL',
  'PURCHASING_DATABASE_URL',
  'PAYMENT_DATABASE_URL',
  'WMS_DATABASE_URL',
  'DISPATCH_DATABASE_URL',
  'COMPLIANCE_DATABASE_URL',
  'LEDGER_DATABASE_URL',
  'NOTIFICATION_DATABASE_URL',
  'ANALYTICS_DATABASE_URL',
] as const
