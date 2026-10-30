/**
 * Points every Prisma client at brand-new, empty databases, so a test can never read or write a
 * developer, staging or production database.
 *
 * - SQLite (default): new files in a fresh OS temp directory.
 * - PostgreSQL (opt-in): when the generated clients are for Postgres and PLEROS_TEST_PG_ADMIN_URL
 *   names a disposable cluster on this machine (localhost only), every schema gets a new database
 *   named pleros_itest_<random>_<schema>, and only those databases are dropped afterwards.
 *
 * MUST be the first import of a test file: it rewrites the *_DATABASE_URL variables before `../db`
 * constructs its clients. Schemas are created from the Prisma schema files with `prisma migrate diff`
 * (offline SQL generation; no `db push`, no migrate, no seed), and `disposeIsolatedDatabases()` deletes
 * the whole directory (or drops this run's databases) afterwards.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
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

/**
 * The generated clients follow the schema files' provider. CI switches every schema to Postgres
 * (scripts/apply-prisma-provider.mjs); without a disposable cluster the tests that need databases are
 * skipped there with this reason instead of failing or touching a real server.
 */
function schemaProvider(schema: string): string {
  const text = fs.readFileSync(path.join(WEB_ROOT, 'prisma', schema, 'schema.prisma'), 'utf8')
  return /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/.exec(text)?.[1] ?? 'unknown'
}
const providers = new Set(['auth', 'tenant', 'ledger'].map(schemaProvider))
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The disposable cluster's maintenance URL, or null. Anything not on this machine is refused outright. */
function pgAdminUrl(): URL | null {
  const raw = process.env.PLEROS_TEST_PG_ADMIN_URL?.trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Refusing to run: PLEROS_TEST_PG_ADMIN_URL is not a URL (value not shown)')
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new Error('Refusing to run: PLEROS_TEST_PG_ADMIN_URL is not a postgres URL')
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('Refusing to run: PLEROS_TEST_PG_ADMIN_URL must point at a disposable cluster on localhost')
  return u
}

const PG_ADMIN = providers.size === 1 && providers.has('postgresql') ? pgAdminUrl() : null
export const ISOLATED_PROVIDER: 'sqlite' | 'postgresql' | null =
  providers.size === 1 && providers.has('sqlite') ? 'sqlite' : PG_ADMIN ? 'postgresql' : null

export const ISOLATED_SKIP: string | false = ISOLATED_PROVIDER
  ? false
  : providers.has('postgresql')
    ? 'isolated databases unavailable: schemas are Postgres and PLEROS_TEST_PG_ADMIN_URL (a disposable local cluster) is not set'
    : `isolated databases unavailable: unsupported schema providers ${[...providers].join(', ')}`

export const ISOLATED_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pleros-bankrecon-test-'))
/** Prefix of every Postgres database this run creates (and the only ones it may drop). */
const PG_PREFIX = `pleros_itest_${randomBytes(4).toString('hex')}_`
const pgCreated = new Set<string>()

function urlFor(schema: string) {
  if (ISOLATED_PROVIDER === 'postgresql') {
    const u = new URL(PG_ADMIN!.href)
    u.pathname = `/${PG_PREFIX}${SCHEMAS[schema]}`
    return u.toString()
  }
  return `file:${path.join(ISOLATED_DIR, `${SCHEMAS[schema]}.db`).replace(/\\/g, '/')}`
}

// Rewritten even when the tests are skipped, so nothing in this process can reach a real database.
for (const schema of Object.keys(SCHEMAS)) {
  process.env[`${schema.toUpperCase()}_DATABASE_URL`] = urlFor(schema)
}
process.env.JWT_SECRET ||= `isolated-test-${process.pid}-${Date.now()}`

/** Throws unless every database URL points at this run's temp directory or this run's Postgres databases. */
export function assertIsolated() {
  const dir = ISOLATED_DIR.replace(/\\/g, '/').toLowerCase()
  for (const schema of Object.keys(SCHEMAS)) {
    const raw = process.env[`${schema.toUpperCase()}_DATABASE_URL`] ?? ''
    if (ISOLATED_PROVIDER === 'postgresql') {
      const u = new URL(raw)
      const ok = LOCAL_HOSTS.has(u.hostname) && u.host === PG_ADMIN!.host && u.pathname === `/${PG_PREFIX}${SCHEMAS[schema]}`
      if (!ok) throw new Error(`Refusing to run: ${schema} database is not isolated`)
      continue
    }
    const url = raw.replace(/\\/g, '/').toLowerCase()
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

type Executor = { $executeRawUnsafe: (sql: string) => Promise<unknown>; $disconnect: () => Promise<void> }

/** A client on the cluster's maintenance database, for CREATE/DROP DATABASE only. */
async function pgAdminClient(): Promise<Executor> {
  const { PrismaClient } = await import('@/generated/prisma-ledger')
  return new PrismaClient({ datasourceUrl: PG_ADMIN!.href, log: [] }) as unknown as Executor
}

/** Creates empty tables for the given schemas in the isolated files (or this run's new Postgres databases). */
export async function prepareIsolatedDatabases(schemas: ('auth' | 'tenant' | 'ledger')[]) {
  assertIsolated()
  if (ISOLATED_PROVIDER === 'postgresql') {
    // Every schema gets a database (the SQLite files exist empty too), so a stray client fails on a
    // missing table instead of a missing database. Names are fresh: CREATE fails rather than reuse one.
    const admin = await pgAdminClient()
    try {
      for (const name of Object.values(SCHEMAS)) {
        await admin.$executeRawUnsafe(`CREATE DATABASE "${PG_PREFIX}${name}"`)
        pgCreated.add(`${PG_PREFIX}${name}`)
      }
    } finally {
      await admin.$disconnect()
    }
  }
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
    if (typeof c?.$disconnect === 'function') await c.$disconnect().catch(() => undefined) // swallow-ok: test teardown; the databases are deleted next
  }
  if (pgCreated.size) {
    const admin = await pgAdminClient()
    try {
      for (const name of pgCreated) {
        if (!name.startsWith(PG_PREFIX)) throw new Error(`Refusing to drop ${name}: not created by this run`)
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
        pgCreated.delete(name)
      }
    } finally {
      await admin.$disconnect()
    }
  }
  fs.rmSync(ISOLATED_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
