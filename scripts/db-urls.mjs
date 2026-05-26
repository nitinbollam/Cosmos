import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const WEB_ROOT = path.join(root, 'apps', 'web')

/** Schema folder name → SQLite file basename (e.g. cosmos_auth.db). */
export const DB_BY_SCHEMA = {
  auth: 'cosmos_auth',
  tenant: 'cosmos_tenant',
  inventory: 'cosmos_inventory',
  order: 'cosmos_order',
  crm: 'cosmos_crm',
  storefront: 'cosmos_storefront',
  purchasing: 'cosmos_purchasing',
  payment: 'cosmos_payment',
  wms: 'cosmos_wms',
  dispatch: 'cosmos_dispatch',
  compliance: 'cosmos_compliance',
  ledger: 'cosmos_ledger',
  notification: 'cosmos_notification',
  analytics: 'cosmos_analytics',
}

export function envKeyForSchema(schemaName) {
  return `${schemaName.toUpperCase()}_DATABASE_URL`
}

/** Absolute file: URL for an embedded SQLite database under apps/web/.data */
export function sqliteDatabaseUrl(dbName, dataDir = '.data') {
  const file = path.join(WEB_ROOT, dataDir, `${dbName}.db`)
  return `file:${file}`
}
