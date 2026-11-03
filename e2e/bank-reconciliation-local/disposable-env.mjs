/**
 * Environment for the local bank-reconciliation demo: all 16 databases in one new temporary
 * directory (SQLite, the default) or, with --postgres, 16 brand-new databases on a disposable
 * Postgres cluster on this machine; every outbound-service credential blanked. Shared by launch.mjs,
 * fixture.ts and the Playwright config, which all refuse to run unless assertDisposableEnv passes.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..')
export const WEB_ROOT = path.join(REPO_ROOT, 'apps', 'web')
export const DEV_DATA_DIR = path.join(WEB_ROOT, '.data')
export const TEMP_PREFIX = 'pleros-bankrecon-demo-'
/** Every Postgres database of a run is named <prefix><file>, with a fresh random prefix per run. */
export const PG_DB_PREFIX = 'pleros_bankrecon_demo_'
const PG_RUN_RE = /^pleros_bankrecon_demo_[0-9a-f]{8}_$/
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Schema folder → SQLite file basename and the export name in apps/web/lib/server/db.ts. */
export const SCHEMAS = {
  auth: ['pleros_auth', 'authDb'],
  tenant: ['pleros_tenant', 'tenantDb'],
  inventory: ['pleros_inventory', 'inventoryDb'],
  order: ['pleros_order', 'orderDb'],
  crm: ['pleros_crm', 'crmDb'],
  storefront: ['pleros_storefront', 'storefrontDb'],
  purchasing: ['pleros_purchasing', 'purchasingDb'],
  payment: ['pleros_payment', 'paymentDb'],
  wms: ['pleros_wms', 'wmsDb'],
  dispatch: ['pleros_dispatch', 'dispatchDb'],
  compliance: ['pleros_compliance', 'complianceDb'],
  ledger: ['pleros_ledger', 'ledgerDb'],
  notification: ['pleros_notification', 'notificationDb'],
  analytics: ['pleros_analytics', 'analyticsDb'],
  marketplace: ['pleros_marketplace', 'marketplaceDb'],
  saleschannels: ['pleros_sales_channels', 'salesChannelsDb'],
}

/** Outbound services that must never be reachable from the demo. */
const BLANKED_KEYS = [
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_CONNECT_WEBHOOK_SECRET',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET', 'NOTIFICATION_WEBHOOK_URL', 'SENDGRID_API_KEY',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'VAPID_PRIVATE_KEY', 'EXPO_PUSH_ACCESS_TOKEN',
  'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'CELESTIAL_OLLAMA_URL', 'OPENTELEMETRY_ENDPOINT',
  'PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLEROS_OTEL_ENABLED', 'ENCRYPTION_KEY',
]
/** Any other apps/web/.env.local name that looks like a credential or endpoint is blanked too. */
const SENSITIVE_NAME_RE = /(KEY|SECRET|TOKEN|PASSWORD|DSN|WEBHOOK|_URL|_URI|_HOST)$/i

const norm = (p) => p.replace(/\\/g, '/').toLowerCase()

export function envKey(schema) {
  return `${schema.toUpperCase()}_DATABASE_URL`
}

/** Names (never values) of the keys in apps/web/.env.local, so the server cannot fall back to them. */
function envLocalNames() {
  const file = path.join(WEB_ROOT, '.env.local')
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.indexOf('=') > 0)
    .map((l) => l.slice(0, l.indexOf('=')).trim())
}

export function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX))
}

/** Provider the generated Prisma clients were built for (they follow the schema files). */
export function generatedProvider() {
  const text = fs.readFileSync(path.join(WEB_ROOT, 'prisma', 'ledger', 'schema.prisma'), 'utf8')
  return /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/.exec(text)?.[1] ?? 'unknown'
}

/**
 * The maintenance URL of a disposable Postgres cluster (BANKTEST_DEMO_PG_ADMIN_URL). Only a server on
 * this machine is accepted; the value is never printed.
 */
export function pgAdminUrl(raw) {
  if (!raw) throw new Error('Refusing: --postgres needs BANKTEST_DEMO_PG_ADMIN_URL (a disposable local cluster)')
  let u
  try {
    u = new URL(raw)
  } catch {
    throw new Error('Refusing: BANKTEST_DEMO_PG_ADMIN_URL is not a URL (value not shown)')
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') throw new Error('Refusing: BANKTEST_DEMO_PG_ADMIN_URL is not a postgres URL')
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('Refusing: BANKTEST_DEMO_PG_ADMIN_URL must point at a disposable cluster on localhost')
  return u
}

export function newPgPrefix() {
  return `${PG_DB_PREFIX}${randomBytes(4).toString('hex')}_`
}

function pgUrl(admin, dbName) {
  const u = new URL(admin.href)
  u.pathname = `/${dbName}`
  return u.toString()
}

/**
 * The full environment for the fixture, the server and the browser test. `pg` ({ admin, prefix })
 * switches every database to this run's new Postgres databases.
 */
export function buildEnv(tmpDir, port, pg = null) {
  const own = {}
  for (const [schema, [file]] of Object.entries(SCHEMAS)) {
    own[envKey(schema)] = pg ? pgUrl(pg.admin, `${pg.prefix}${file}`) : `file:${path.join(tmpDir, `${file}.db`).replace(/\\/g, '/')}`
  }
  Object.assign(own, {
    PLEROS_DB_PROVIDER: pg ? 'postgres' : 'sqlite',
    BANKTEST_DEMO_PG_PREFIX: pg ? pg.prefix : '',
    BANKTEST_DEMO_PG_HOST: pg ? pg.admin.host : '',
    // The maintenance URL stays with launch.mjs; the server and the browser test never get it.
    BANKTEST_DEMO_PG_ADMIN_URL: '',
    DATABASE_URL: '',
    NODE_ENV: 'development',
    PORT: String(port),
    PLEROS_CLIENT_ORIGIN: `http://localhost:${port}`,
    APP_URL: `http://localhost:${port}`,
    NEXT_PUBLIC_WEB_ADMIN_ORIGIN: `http://localhost:${port}`,
    NEXT_PUBLIC_GATEWAY_URL: '/api/v1',
    JWT_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    BANKTEST_DEMO_TMP: tmpDir,
    BANKTEST_DEMO_BASE_URL: `http://localhost:${port}`,
  })
  for (const key of BLANKED_KEYS) own[key] = ''
  // Every other credential-like or endpoint-like name in .env.local is defined (blank) here, so the
  // server's .env.local loader, which only fills undefined keys, can never supply its value.
  let extraBlanked = 0
  for (const key of envLocalNames()) {
    if (key in own || !SENSITIVE_NAME_RE.test(key)) continue
    own[key] = ''
    extraBlanked++
  }
  own.BANKTEST_DEMO_EXTRA_BLANKED = String(extraBlanked)
  return { ...process.env, ...own }
}

/**
 * Throws unless every database URL is a SQLite file inside `tmpDir` (a fresh directory under the OS
 * temp folder created for this run), none points at apps/web/.data, and nothing remote is configured.
 * In Postgres mode every URL must instead be one of this run's new databases on the local cluster.
 */
export function assertDisposableEnv(env, tmpDir) {
  if (!tmpDir) throw new Error('Refusing: no disposable directory (run through launch.mjs)')
  const dir = norm(path.resolve(tmpDir))
  const osTmp = norm(path.resolve(os.tmpdir()))
  if (!dir.startsWith(`${osTmp}/`) || !path.basename(dir).startsWith(TEMP_PREFIX)) {
    throw new Error('Refusing: the database directory is not a new pleros-bankrecon-demo-* folder in the OS temp directory')
  }
  if (env.PLEROS_DB_PROVIDER !== 'sqlite' && env.PLEROS_DB_PROVIDER !== 'postgres') {
    throw new Error('Refusing: PLEROS_DB_PROVIDER must be sqlite or postgres')
  }
  if (env.DATABASE_URL) throw new Error('Refusing: DATABASE_URL must be empty')
  const dataDir = norm(path.resolve(DEV_DATA_DIR))
  const keys = Object.keys(env).filter((k) => k.endsWith('_DATABASE_URL') && k !== 'DATABASE_URL')
  const expected = Object.keys(SCHEMAS).map(envKey)
  for (const k of expected) if (!keys.includes(k)) throw new Error(`Refusing: ${k} is not set`)
  if (env.PLEROS_DB_PROVIDER === 'postgres') {
    const prefix = env.BANKTEST_DEMO_PG_PREFIX ?? ''
    const host = env.BANKTEST_DEMO_PG_HOST ?? ''
    if (!PG_RUN_RE.test(prefix) || !host) throw new Error('Refusing: no Postgres run prefix (run through launch.mjs --postgres)')
    const files = new Set(Object.values(SCHEMAS).map(([file]) => `/${prefix}${file}`))
    for (const k of keys) {
      let u
      try {
        u = new URL(env[k] ?? '')
      } catch {
        throw new Error(`Refusing: ${k} is not a URL`)
      }
      const ok = (u.protocol === 'postgresql:' || u.protocol === 'postgres:') && LOCAL_HOSTS.has(u.hostname) && u.host === host
      if (!ok) throw new Error(`Refusing: ${k} is not on the disposable local cluster`)
      if (!files.has(u.pathname)) throw new Error(`Refusing: ${k} is not one of this run's new databases`)
    }
    return keys.length
  }
  for (const k of keys) {
    const url = norm(env[k] ?? '')
    if (!url.startsWith('file:')) throw new Error(`Refusing: ${k} is not a local SQLite file`)
    const file = url.slice('file:'.length).split('?')[0]
    if (file.startsWith(`${dataDir}/`) || file.includes('/apps/web/.data/')) throw new Error(`Refusing: ${k} points at apps/web/.data`)
    if (!file.startsWith(`${dir}/`)) throw new Error(`Refusing: ${k} is outside the disposable directory`)
  }
  return keys.length
}

/** Sanitized description of the targets: file names relative to the temp folder, or host and database (no credentials). */
export function describeTargets(env, tmpDir) {
  if (env.PLEROS_DB_PROVIDER === 'postgres') {
    return Object.keys(SCHEMAS).map((s) => {
      const u = new URL(env[envKey(s)])
      return `${envKey(s)} -> postgresql://***@${u.host}${u.pathname}`
    })
  }
  const base = `<os-temp>/${path.basename(tmpDir)}`
  return Object.keys(SCHEMAS).map((s) => `${envKey(s)} -> ${base}/${path.basename(env[envKey(s)])}`)
}

/** Removes the run's temp directory, and only that directory. */
export function removeTempDir(tmpDir) {
  const dir = path.resolve(tmpDir)
  const osTmp = path.resolve(os.tmpdir())
  if (path.dirname(dir) !== osTmp || !path.basename(dir).startsWith(TEMP_PREFIX)) {
    throw new Error('Refusing to delete a directory that is not this run\'s pleros-bankrecon-demo-* folder')
  }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
}
