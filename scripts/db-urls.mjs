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

export const WEB_DATABASE_ENV_KEYS = Object.keys(DB_BY_SCHEMA).map(
  (schema) => `${schema.toUpperCase()}_DATABASE_URL`,
)

export function envKeyForSchema(schemaName) {
  return `${schemaName.toUpperCase()}_DATABASE_URL`
}

export function getDbProvider() {
  return process.env.COSMOS_DB_PROVIDER === 'postgres' ? 'postgresql' : 'sqlite'
}

/** Absolute file: URL for an embedded SQLite database under apps/web/.data */
export function sqliteDatabaseUrl(dbName, dataDir = '.data') {
  const file = path.join(WEB_ROOT, dataDir, `${dbName}.db`)
  return `file:${file}`
}

/** Build per-domain Postgres URL from a base connection string. */
export function postgresDatabaseUrl(baseUrl, dbName) {
  try {
    const u = new URL(baseUrl)
    u.pathname = `/${dbName}`
    return u.toString()
  } catch {
    return `${String(baseUrl).replace(/\/[^/]*$/, '')}/${dbName}`
  }
}

export function databaseUrlForSchema(schemaName, options = {}) {
  const dbName = DB_BY_SCHEMA[schemaName]
  if (!dbName) throw new Error(`Unknown schema: ${schemaName}`)
  const envKey = envKeyForSchema(schemaName)
  if (process.env[envKey]?.trim()) return process.env[envKey].trim()

  if (getDbProvider() === 'postgresql') {
    const base =
      process.env.DATABASE_URL?.trim() ||
      'postgresql://cosmos:cosmos@localhost:5432/postgres'
    return postgresDatabaseUrl(base, dbName)
  }

  const dataDir = options.dataDir ?? process.env.COSMOS_DATA_DIR ?? '.data'
  return sqliteDatabaseUrl(dbName, dataDir)
}

export function resolveAllDatabaseUrls(options = {}) {
  const urls = {}
  for (const schema of Object.keys(DB_BY_SCHEMA)) {
    urls[envKeyForSchema(schema)] = databaseUrlForSchema(schema, options)
  }
  return urls
}
