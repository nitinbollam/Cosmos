/**
 * Points every Prisma client at brand-new SQLite files in a fresh OS temp directory, so a test can
 * never read or write a developer, staging or production database.
 *
 * MUST be the first import of a test file: it rewrites the *_DATABASE_URL variables before `../db`
 * constructs its clients. Schemas are created from the Prisma schema files with `prisma migrate diff`
 * (offline SQL generation; no `db push`, no migrate, no seed), and `disposeIsolatedDatabases()` deletes
 * the whole directory afterwards.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const SCHEMAS: Record<string, string> = {
  auth: 'pleros_auth',
  tenant: 'pleros_tenant',
  inventory: 'pleros_inventory',
  order: 'pleros_order',
  crm: 'pleros_crm',
  storefront: 'pleros_storefront',
  purchasing: 'pleros_purchasing',
  payment: 'pleros_payment',
  wms: 'pleros_wms',
  dispatch: 'pleros_dispatch',
  compliance: 'pleros_compliance',
  ledger: 'pleros_ledger',
  notification: 'pleros_notification',
  analytics: 'pleros_analytics',
  marketplace: 'pleros_marketplace',
  saleschannels: 'pleros_sales_channels',
}

export const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pleros-bankrecon-test-'))

function urlFor(schema: string) {
  return `file:${path.join(ISOLATED_DIR, `${SCHEMAS[schema]}.db`).replace(/\\/g, '/')}`
}

for (const schema of Object.keys(SCHEMAS)) {
  process.env[`${schema.toUpperCase()}_DATABASE_URL`] = urlFor(schema)
}
process.env.JWT_SECRET ||= `isolated-test-${process.pid}-${Date.now()}`

/** Throws unless every database URL points inside this run's temp directory. */
export function assertIsolated() {
  const dir = ISOLATED_DIR.replace(/\\/g, '/').toLowerCase()
  for (const schema of Object.keys(SCHEMAS)) {
    const url = (process.env[`${schema.toUpperCase()}_DATABASE_URL`] ?? '').replace(/\\/g, '/').toLowerCase()
    if (!url.startsWith(`file:${dir}/`)) throw new Error(`Refusing to run: ${schema} database is not isolated`)
  }
}

function schemaSql(schema: string): string[] {
  const prismaCli = require.resolve('prisma/build/index.js')
  const sql = execFileSync(
    process.execPath,
    [prismaCli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(WEB_ROOT, 'prisma', schema, 'schema.prisma'), '--script'],
    { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
}

type Executor = { $executeRawUnsafe: (sql: string) => Promise<unknown> }

/** Creates empty tables for the given schemas in the isolated files. */
export async function prepareIsolatedDatabases(schemas: ('auth' | 'tenant' | 'ledger')[]) {
  assertIsolated()
  const db = await import('../db')
  const clients: Record<string, Executor> = { auth: db.authDb, tenant: db.tenantDb, ledger: db.ledgerDb }
  for (const schema of schemas) {
    for (const stmt of schemaSql(schema)) await clients[schema]!.$executeRawUnsafe(stmt)
  }
}

export async function disposeIsolatedDatabases() {
  const db = (await import('../db')) as Record<string, unknown>
  for (const client of Object.values(db)) {
    const c = client as { $disconnect?: () => Promise<void> }
    if (typeof c?.$disconnect === 'function') await c.$disconnect().catch(() => undefined)
  }
  fs.rmSync(ISOLATED_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
