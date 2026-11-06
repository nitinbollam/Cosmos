/**
 * Points every Prisma client at brand-new, empty databases, so a test can never read or write a
 * developer, staging or production database.
 *
 * - SQLite (default): new files in a fresh OS temp directory.
 * - PostgreSQL (opt-in): when the generated clients are for Postgres and both PostgreSQL test
 *   settings identify a disposable temporary cluster, every schema gets a new database
 *   named pleros_itest_<random>_<schema>, and only those databases are dropped afterwards.
 *   After initializing the disposable cluster, write its server-reported pg_control_system()
 *   system_identifier to <data-directory>/.pleros-test-disposable and set
 *   PLEROS_TEST_PG_DATA_DIR alongside PLEROS_TEST_PG_ADMIN_URL.
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
const providers = new Set(Object.keys(SCHEMAS).map(schemaProvider))
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The disposable cluster's maintenance URL, or null. Anything not on this machine is refused outright. */
export function validatePgAdminUrl(rawValue: string | undefined): URL | null {
  const raw = rawValue?.trim()
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Refusing to run: PLEROS_TEST_PG_ADMIN_URL is not a URL (value not shown)')
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new Error('Refusing to run: PLEROS_TEST_PG_ADMIN_URL is not a postgres URL')
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('Refusing to run: PLEROS_TEST_PG_ADMIN_URL must point at a disposable cluster on localhost')
  if (!u.port || Number(u.port) === 5432) throw new Error('Refusing to run: PostgreSQL test URL must use an explicit non-default port')
  return u
}

const expectedPgDataDir = process.env.PLEROS_TEST_PG_DATA_DIR?.trim()
const PG_ADMIN = providers.size === 1 && providers.has('postgresql')
  ? validatePgAdminUrl(process.env.PLEROS_TEST_PG_ADMIN_URL)
  : null
export const ISOLATED_PROVIDER: 'sqlite' | 'postgresql' | null =
  providers.size === 1 && providers.has('sqlite')
    ? 'sqlite'
    : PG_ADMIN && expectedPgDataDir
      ? 'postgresql'
      : null

export const ISOLATED_SKIP: string | false = ISOLATED_PROVIDER
  ? false
  : providers.has('postgresql')
    ? 'isolated databases unavailable: schemas are Postgres and disposable local PostgreSQL settings are not set'
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
type PgIdentity = { dataDirectory: string; port: number; listenAddresses: string[]; systemIdentifier: string }
type QueryExecutor = Executor & { $queryRawUnsafe: <T>(sql: string) => Promise<T> }
let verifiedPgIdentity: PgIdentity | null = null

/** A client on the cluster's maintenance database, for CREATE/DROP DATABASE only. */
async function pgAdminClient(): Promise<Executor> {
  const { PrismaClient } = await import('@/generated/prisma-ledger')
  return new PrismaClient({ datasourceUrl: PG_ADMIN!.href, log: [] }) as unknown as Executor
}

async function verifyDisposableCluster(admin: Executor): Promise<PgIdentity> {
  if (!PG_ADMIN || !expectedPgDataDir) {
    throw new Error('Refusing to run: disposable PostgreSQL URL and data directory are both required')
  }
  const expectedReal = fs.realpathSync(expectedPgDataDir)
  const allowedRoots = [...new Set(['/private/tmp', os.tmpdir()])]
    .map((root) => {
      try { return fs.realpathSync(root) } catch { return root }
    })
  if (!allowedRoots.some((root) => expectedReal === root || expectedReal.startsWith(`${root}${path.sep}`))) {
    throw new Error('Refusing to run: PostgreSQL data directory must be under a temporary directory')
  }
  const client = admin as QueryExecutor
  const rows = await client.$queryRawUnsafe<Array<{
    data_directory: string
    server_port: number
    listen_addresses: string
    system_identifier: string
  }>>(`SELECT current_setting('data_directory') AS data_directory,
              current_setting('port')::int AS server_port,
              current_setting('listen_addresses') AS listen_addresses,
              (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier`)
  const row = rows[0]
  if (!row?.data_directory || !row.system_identifier || !/^\d+$/.test(row.system_identifier)) {
    throw new Error('Refusing to run: PostgreSQL cluster identity could not be verified')
  }
  let markedSystemIdentifier = ''
  try {
    // Provisioning must create this marker with the server-reported identifier after initdb.
    // Matching it to pg_control_system() proves the marker belongs to this exact cluster.
    markedSystemIdentifier = fs.readFileSync(path.join(expectedReal, '.pleros-test-disposable'), 'utf8').trim()
  } catch {
    throw new Error('Refusing to run: PostgreSQL cluster lacks its disposable-cluster marker')
  }
  const actualReal = fs.realpathSync(row.data_directory)
  const listenAddresses = row.listen_addresses.split(',').map((address) => address.trim()).filter(Boolean)
  if (
    actualReal !== expectedReal ||
    markedSystemIdentifier !== row.system_identifier ||
    Number(row.server_port) !== Number(PG_ADMIN.port) ||
    listenAddresses.length !== 1 ||
    listenAddresses[0] !== '127.0.0.1'
  ) {
    throw new Error('Refusing to run: PostgreSQL server identity does not match the disposable target')
  }
  return {
    dataDirectory: actualReal,
    port: Number(row.server_port),
    listenAddresses,
    systemIdentifier: row.system_identifier,
  }
}

async function verifySameCluster(admin: Executor) {
  const current = await verifyDisposableCluster(admin)
  if (
    !verifiedPgIdentity ||
    current.dataDirectory !== verifiedPgIdentity.dataDirectory ||
    current.port !== verifiedPgIdentity.port ||
    current.systemIdentifier !== verifiedPgIdentity.systemIdentifier
  ) {
    throw new Error('Refusing to run: PostgreSQL cluster identity changed during isolated test setup')
  }
}

/** Creates empty tables for the given schemas in the isolated files (or this run's new Postgres databases). */
export async function prepareIsolatedDatabases(schemas: (keyof typeof SCHEMAS)[]) {
  assertIsolated()
  if (ISOLATED_PROVIDER === 'postgresql') {
    // Every schema gets a database (the SQLite files exist empty too), so a stray client fails on a
    // missing table instead of a missing database. Names are fresh: CREATE fails rather than reuse one.
    const admin = await pgAdminClient()
    try {
      verifiedPgIdentity = await verifyDisposableCluster(admin)
      for (const name of Object.values(SCHEMAS)) {
        await verifySameCluster(admin)
        await admin.$executeRawUnsafe(`CREATE DATABASE "${PG_PREFIX}${name}"`)
        pgCreated.add(`${PG_PREFIX}${name}`)
      }
    } finally {
      await admin.$disconnect()
    }
  }
  const db = (await import('../db')) as unknown as Record<string, Executor>
  const clientNames: Record<keyof typeof SCHEMAS, string> = {
    auth: 'authDb',
    tenant: 'tenantDb',
    inventory: 'inventoryDb',
    order: 'orderDb',
    crm: 'crmDb',
    storefront: 'storefrontDb',
    wms: 'wmsDb',
    dispatch: 'dispatchDb',
    purchasing: 'purchasingDb',
    payment: 'paymentDb',
    compliance: 'complianceDb',
    notification: 'notificationDb',
    ledger: 'ledgerDb',
    analytics: 'analyticsDb',
    marketplace: 'marketplaceDb',
    saleschannels: 'salesChannelsDb',
  }
  for (const schema of schemas) {
    for (const stmt of schemaSql(schema)) await db[clientNames[schema]]!.$executeRawUnsafe(stmt)
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
      await verifySameCluster(admin)
      for (const name of pgCreated) {
        if (!name.startsWith(PG_PREFIX)) throw new Error(`Refusing to drop ${name}: not created by this run`)
        await verifySameCluster(admin)
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
        pgCreated.delete(name)
      }
    } finally {
      await admin.$disconnect()
    }
  }
  fs.rmSync(ISOLATED_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
