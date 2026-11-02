import { WEB_DATABASE_ENV_KEYS } from './env'

type DbCheck = { key: string; ok: boolean; message?: string }

export function getDatabaseProvider(): 'sqlite' | 'postgresql' {
  return process.env.PLEROS_DB_PROVIDER === 'postgres' ? 'postgresql' : 'sqlite'
}

type Probe = { $queryRaw: (query: TemplateStringsArray) => Promise<unknown> }

/** One probe per domain database, keyed by the env var that points at it. */
async function databaseProbes(): Promise<Array<[string, Probe]>> {
  const db = await import('./db')
  return [
    ['AUTH_DATABASE_URL', db.authDb],
    ['TENANT_DATABASE_URL', db.tenantDb],
    ['INVENTORY_DATABASE_URL', db.inventoryDb],
    ['ORDER_DATABASE_URL', db.orderDb],
    ['CRM_DATABASE_URL', db.crmDb],
    ['STOREFRONT_DATABASE_URL', db.storefrontDb],
    ['PURCHASING_DATABASE_URL', db.purchasingDb],
    ['PAYMENT_DATABASE_URL', db.paymentDb],
    ['WMS_DATABASE_URL', db.wmsDb],
    ['DISPATCH_DATABASE_URL', db.dispatchDb],
    ['COMPLIANCE_DATABASE_URL', db.complianceDb],
    ['LEDGER_DATABASE_URL', db.ledgerDb],
    ['NOTIFICATION_DATABASE_URL', db.notificationDb],
    ['ANALYTICS_DATABASE_URL', db.analyticsDb],
    ['MARKETPLACE_DATABASE_URL', db.marketplaceDb],
    ['SALESCHANNELS_DATABASE_URL', db.salesChannelsDb],
  ] as Array<[string, Probe]>
}

/**
 * The cause line of a driver error (Prisma puts it last, after the call-site frame), without
 * connection strings, which can carry a password.
 */
function shortCause(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  const line = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? 'connect failed'
  return line.replace(/\b(postgres(?:ql)?:\/\/)[^\s@]*@/gi, '$1***@')
}

export async function checkDatabaseConnections(): Promise<{
  provider: string
  checks: DbCheck[]
  allOk: boolean
}> {
  const provider = getDatabaseProvider()
  const checks: DbCheck[] = []
  const probes = new Map(await databaseProbes())

  for (const key of WEB_DATABASE_ENV_KEYS) {
    const url = process.env[key]
    if (!url?.trim()) {
      checks.push({ key, ok: false, message: 'missing URL' })
      continue
    }
    const probe = probes.get(key)
    if (!probe) {
      checks.push({ key, ok: true, message: 'configured' })
      continue
    }
    try {
      await probe.$queryRaw`SELECT 1`
      checks.push({ key, ok: true, message: 'ok' })
    } catch (e) {
      checks.push({ key, ok: false, message: shortCause(e) })
    }
  }

  return {
    provider,
    checks,
    allOk: checks.every((c) => c.ok),
  }
}

/**
 * Boot-time check: every domain database must be configured and reachable. A missing one used to
 * surface only as a generic 500 on the first request that touched it (ticket 62: sales channels on
 * staging). Each failure is logged by env var; in production the boot fails, so the deploy fails
 * instead of serving a broken screen.
 */
export async function assertDatabasesReachable(isProd: boolean): Promise<void> {
  const { checks } = await checkDatabaseConnections()
  const failed = checks.filter((c) => !c.ok)
  if (failed.length === 0) return
  for (const c of failed) console.error(`[db] ${c.key} is not usable: ${c.message}`)
  if (isProd) {
    throw new Error(`${failed.length} database(s) unavailable: ${failed.map((c) => c.key).join(', ')}`)
  }
}

/**
 * Prisma errors that mean the database itself is missing or unreachable (not a bad request):
 * P1000 auth failed, P1001 can't reach server, P1003 database doesn't exist, P2021 table missing.
 */
const UNAVAILABLE_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1003', 'P1017', 'P2021'])

export function isDatabaseUnavailableError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as { name?: string; code?: string; errorCode?: string }
  if (err.name === 'PrismaClientInitializationError') return true
  return UNAVAILABLE_CODES.has(err.code ?? err.errorCode ?? '')
}
