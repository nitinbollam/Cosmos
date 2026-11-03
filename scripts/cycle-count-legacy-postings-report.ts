/**
 * Read-only report of stock postings that cycle-count approvals made before ticket 49 gave each posting an
 * idempotency key.
 *
 *   npx tsx scripts/cycle-count-legacy-postings-report.ts --help
 *
 * An approval that failed partway, was retried or ran twice at once could post a line's stock change more than
 * once, and those postings carry nothing that ties them to a line. Approval now refuses (409) a count with such a
 * posting until a person has reviewed it. This script lists them, per count, for that review:
 *
 *   NO_HISTORICAL_POSTINGS ... nothing to review
 *   POTENTIALLY_RECOVERABLE .. every posting has exactly one line it can belong to (still needs a person to accept it)
 *   AMBIGUOUS ................ some posting cannot be tied to a single line (no line, several lines, other quantity,
 *                              warehouse, batch or tenant, or posted before the count was submitted)
 *   POSSIBLE_DUPLICATE ....... more postings for a SKU than lines: stock was probably changed more than once
 *
 * It is read-only by design: Prisma reads only, inside one transaction per database that is made READ ONLY on
 * Postgres and PRAGMA query_only on SQLite. It never changes stock, ledger rows, accounting, or cycle counts.
 * Output is ids, quantities, timestamps and correlation ids only. Production is refused unless separately
 * reviewed and explicitly authorized.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import {
  classifyLegacyPostings,
  type CountFinding,
  type LegacyClassification,
  type LegacyCount,
  type LegacyEntry,
  type LegacyLine,
} from '../apps/web/lib/server/cycle-count-legacy'

const require = createRequire(import.meta.url)

const SCRIPT = 'scripts/cycle-count-legacy-postings-report.ts'
const PROD_ENV_KEYS = ['RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_ENVIRONMENT', 'RENDER_SERVICE_NAME', 'APP_ENV', 'PLEROS_ENV']
const ALLOWED_ENVS = new Set(['local', 'staging', 'production'])
const APPROVAL_RE = /^[A-Z][A-Z0-9]+-\d+$/
const CHUNK = 500

const EXIT_OK = 0
const EXIT_FINDINGS = 1
const EXIT_REFUSED = 2
const EXIT_USAGE = 64

const HELP = `Usage: npx tsx ${SCRIPT} [options]

Read-only review of cycle-count stock postings made without an idempotency key (before ticket 49).
Never changes stock, ledger rows, accounting jobs, or cycle counts.

Environment (set explicitly in the shell; .env files are not used):
  CYCLE_COUNT_REPORT_ENV=local|staging|production   Required; declares the target
  INVENTORY_DATABASE_URL                            Inventory database (stock ledger)
  WMS_DATABASE_URL                                  WMS database (cycle counts)
  CYCLE_COUNT_REPORT_PRODUCTION_DB_FINGERPRINTS     Optional comma list; refused unless production is authorized

Options:
  --tenant <id>                          Only this tenant's postings
  --json                                 Machine-readable output
  --expect-inventory-fingerprint <hex>   Refuse unless INVENTORY_DATABASE_URL has this fingerprint
  --expect-wms-fingerprint <hex>         Refuse unless WMS_DATABASE_URL has this fingerprint
  --production-approval <TICKET-1>       Required (with CYCLE_COUNT_REPORT_ENV=production) after a separate review;
                                         also needs both --expect-*-fingerprint options
  --help                                 Show this help

Manual reconciliation (a reviewed decision per count; this script does none of it):
  1. Check each listed posting against the count sheet, the stock ledger for the SKU, and whoever approved it.
  2. Accepting a posting as a line's adjustment: record its ledger entry id as that line's postedLedgerId in the
     WMS database. Approval then treats the line as posted and the posting as reviewed, and posts only the
     remaining lines (each exactly once, by idempotency key).
  3. A posting that duplicated an earlier one: correct the stock with an ordinary, documented stock adjustment,
     reviewed by finance for its journal. The duplicate stays in the ledger as history (never delete or edit
     ledger rows). A count whose postings cannot all be accepted is closed by a reviewed WMS change, not by
     approving it again.
  4. Run this report again; the count should show NO_HISTORICAL_POSTINGS before anyone approves it.

Exit codes: 0 nothing to review, 1 postings need review or failure, 2 refused by a safety check, 64 usage error.`

class UsageError extends Error {}
class RefusedError extends Error {}

type Args = {
  help: boolean
  json: boolean
  tenant?: string
  expectInventoryFingerprint?: string
  expectWmsFingerprint?: string
  productionApproval?: string
}

const VALUE_OPTIONS: Record<string, keyof Args> = {
  '--tenant': 'tenant',
  '--expect-inventory-fingerprint': 'expectInventoryFingerprint',
  '--expect-wms-fingerprint': 'expectWmsFingerprint',
  '--production-approval': 'productionApproval',
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--json') args.json = true
    else if (VALUE_OPTIONS[arg]) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new UsageError(`Missing value for ${arg}`)
      const key = VALUE_OPTIONS[arg]!
      if (args[key] !== undefined) throw new UsageError(`${arg} given more than once`)
      ;(args as Record<string, unknown>)[key] = value
      i++
    } else throw new UsageError(`Unknown argument "${arg}"`)
  }
  return args
}

type Fingerprint = { kind: 'sqlite' | 'postgresql'; fingerprint: string; nameHint: string }

/** Identifies a database without credentials: hash of scheme, host, port and database path. */
function databaseFingerprint(name: string, url: string): Fingerprint {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)
  if (url.startsWith('file:')) {
    const file = path.resolve(url.slice('file:'.length).split('?')[0]!)
    return { kind: 'sqlite', fingerprint: sha(`sqlite|${file.toLowerCase()}`), nameHint: path.basename(file) }
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new RefusedError(`${name} is not parseable (value not shown)`)
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new RefusedError(`Unsupported database scheme ${u.protocol} in ${name}`)
  const host = u.hostname.toLowerCase()
  const db = u.pathname.replace(/^\//, '')
  return { kind: 'postgresql', fingerprint: sha(`postgresql|${host}|${u.port || '5432'}|${db}`), nameHint: `${host}|${db}` }
}

/** Refuses production unless it was declared, reviewed (approval reference) and bound to both fingerprints. */
function assertTargetAllowed(args: Args, inventory: Fingerprint, wms: Fingerprint) {
  const env = process.env.CYCLE_COUNT_REPORT_ENV ?? ''
  if (!ALLOWED_ENVS.has(env)) throw new RefusedError('CYCLE_COUNT_REPORT_ENV must be local, staging or production')
  const deniedFps = new Set(
    (process.env.CYCLE_COUNT_REPORT_PRODUCTION_DB_FINGERPRINTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
  const signals = [
    ...PROD_ENV_KEYS.filter((k) => /prod/i.test(process.env[k] ?? '')).map((k) => `${k} indicates production`),
    ...[inventory, wms].filter((fp) => /prod/i.test(fp.nameHint)).map(() => 'database host or name indicates production'),
    ...[inventory, wms].filter((fp) => deniedFps.has(fp.fingerprint)).map(() => 'database fingerprint is listed as production'),
  ]
  if (args.expectInventoryFingerprint && args.expectInventoryFingerprint.toLowerCase() !== inventory.fingerprint) {
    throw new RefusedError('--expect-inventory-fingerprint does not match INVENTORY_DATABASE_URL')
  }
  if (args.expectWmsFingerprint && args.expectWmsFingerprint.toLowerCase() !== wms.fingerprint) {
    throw new RefusedError('--expect-wms-fingerprint does not match WMS_DATABASE_URL')
  }
  if (env !== 'production') {
    if (signals.length) throw new RefusedError(`${signals[0]}; production needs a separate review (see --help)`)
    if (args.productionApproval) throw new UsageError('--production-approval is only valid with CYCLE_COUNT_REPORT_ENV=production')
    return
  }
  if (!args.productionApproval || !APPROVAL_RE.test(args.productionApproval)) {
    throw new RefusedError('Production needs --production-approval <TICKET-123> from the separate review')
  }
  if (!args.expectInventoryFingerprint || !args.expectWmsFingerprint) {
    throw new RefusedError('Production needs --expect-inventory-fingerprint and --expect-wms-fingerprint of the reviewed databases')
  }
}

// ---------------------------------------------------------------------------------------------
// Database phase. Prisma is loaded only here, after every offline check has passed.

type ReadOnlyClient = {
  $transaction: <T>(fn: (tx: never) => Promise<T>, opts?: { maxWait?: number; timeout?: number }) => Promise<T>
  $disconnect: () => Promise<void>
}

/** Runs `fn` in one transaction whose first statement makes its connection read-only. */
function readOnly<T>(db: ReadOnlyClient, kind: Fingerprint['kind'], fn: (tx: never) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await (tx as { $executeRawUnsafe: (sql: string) => Promise<number> }).$executeRawUnsafe(
        kind === 'sqlite' ? 'PRAGMA query_only = ON' : 'SET TRANSACTION READ ONLY',
      )
      return fn(tx)
    },
    { maxWait: 10_000, timeout: 120_000 },
  )
}

type RawTx = { $queryRawUnsafe: <R>(sql: string, ...params: unknown[]) => Promise<R> }

/** Whether a column exists, so the report also runs before the ticket 49 schema is deployed. */
async function columnExists(tx: unknown, kind: Fingerprint['kind'], table: string, column: string): Promise<boolean> {
  const rows =
    kind === 'sqlite'
      ? await (tx as RawTx).$queryRawUnsafe<unknown[]>(`SELECT name FROM pragma_table_info(?) WHERE name = ?`, table, column)
      : await (tx as RawTx).$queryRawUnsafe<unknown[]>(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
          table,
          column,
        )
  return rows.length > 0
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK))
  return out
}

type Report = {
  generatedAt: string
  tenant: string | null
  inventory: { kind: string; fingerprint: string }
  wms: { kind: string; fingerprint: string }
  pendingCountsWithoutHistoricalPostings: number
  summary: Record<LegacyClassification, number>
  findings: CountFinding[]
}

async function collect(args: Args, invUrl: string, invFp: Fingerprint, wmsUrl: string, wmsFp: Fingerprint): Promise<Report> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrismaClient: InventoryClient } = require('../apps/web/generated/prisma-inventory') as typeof import('../apps/web/generated/prisma-inventory')
  const { PrismaClient: WmsClient } = require('../apps/web/generated/prisma-wms') as typeof import('../apps/web/generated/prisma-wms')
  /* eslint-enable @typescript-eslint/no-require-imports */
  const inventoryDb = new InventoryClient({ datasources: { db: { url: invUrl } }, log: [] })
  const wmsDb = new WmsClient({ datasources: { db: { url: wmsUrl } }, log: [] })
  type InvTx = Parameters<Parameters<typeof inventoryDb.$transaction>[0]>[0]
  type WmsTx = Parameters<Parameters<typeof wmsDb.$transaction>[0]>[0]
  try {
    const entries = await readOnly(inventoryDb as unknown as ReadOnlyClient, invFp.kind, async (raw: never) => {
      const tx = raw as InvTx
      // Before the schema has the key, every cycle-count posting is a legacy one.
      const keyed = await columnExists(tx, invFp.kind, 'StockLedgerEntry', 'idempotencyKey')
      return tx.stockLedgerEntry.findMany({
        where: {
          referenceType: 'CYCLE_COUNT',
          eventType: 'STOCK_ADJUSTED',
          ...(keyed ? { idempotencyKey: null } : {}),
          referenceId: { not: null },
          ...(args.tenant ? { tenantId: args.tenant } : {}),
        },
        select: {
          id: true, tenantId: true, skuId: true, warehouseId: true, batchId: true,
          quantityDelta: true, correlationId: true, occurredAt: true, referenceId: true,
        },
        orderBy: [{ referenceId: 'asc' }, { occurredAt: 'asc' }, { id: 'asc' }],
      })
    })
    const countIds = [...new Set(entries.map((e) => e.referenceId!))]

    const { counts, lines, pendingTotal, pendingWithPostings } = await readOnly(wmsDb as unknown as ReadOnlyClient, wmsFp.kind, async (raw: never) => {
      const tx = raw as WmsTx
      const marked = await columnExists(tx, wmsFp.kind, 'CycleCountLine', 'postedLedgerId')
      const counts: Array<LegacyCount> = []
      const lines: Array<LegacyLine & { countId: string }> = []
      for (const ids of chunks(countIds)) {
        counts.push(
          ...(await tx.cycleCount.findMany({
            where: { id: { in: ids } },
            select: { id: true, tenantId: true, warehouseId: true, status: true, submittedAt: true },
          })),
        )
        const found = await tx.cycleCountLine.findMany({
          where: { countId: { in: ids } },
          select: { id: true, countId: true, skuId: true, systemQty: true, countedQty: true, ...(marked ? { postedLedgerId: true } : {}) },
        })
        lines.push(...found.map((l) => ({ ...l, postedLedgerId: (l as { postedLedgerId?: string | null }).postedLedgerId ?? null })))
      }
      const pendingWhere = { status: 'PENDING_APPROVAL' as const, ...(args.tenant ? { tenantId: args.tenant } : {}) }
      const pendingTotal = await tx.cycleCount.count({ where: pendingWhere })
      let pendingWithPostings = 0
      for (const ids of chunks(countIds)) pendingWithPostings += await tx.cycleCount.count({ where: { ...pendingWhere, id: { in: ids } } })
      return { counts, lines, pendingTotal, pendingWithPostings }
    })

    const countById = new Map(counts.map((c) => [c.id, c]))
    const findings = countIds.map((id) =>
      classifyLegacyPostings(
        countById.get(id) ?? null,
        lines.filter((l) => l.countId === id),
        entries.filter((e) => e.referenceId === id) as LegacyEntry[],
        id,
      ),
    )
    const summary: Record<LegacyClassification, number> = { NO_HISTORICAL_POSTINGS: 0, POTENTIALLY_RECOVERABLE: 0, AMBIGUOUS: 0, POSSIBLE_DUPLICATE: 0 }
    for (const f of findings) summary[f.classification]++
    return {
      generatedAt: new Date().toISOString(),
      tenant: args.tenant ?? null,
      inventory: { kind: invFp.kind, fingerprint: invFp.fingerprint },
      wms: { kind: wmsFp.kind, fingerprint: wmsFp.fingerprint },
      pendingCountsWithoutHistoricalPostings: pendingTotal - pendingWithPostings,
      summary,
      findings,
    }
  } finally {
    await Promise.all([inventoryDb.$disconnect(), wmsDb.$disconnect()])
  }
}

const ORDER: LegacyClassification[] = ['POSSIBLE_DUPLICATE', 'AMBIGUOUS', 'POTENTIALLY_RECOVERABLE', 'NO_HISTORICAL_POSTINGS']

function printText(r: Report) {
  console.log(`Cycle-count legacy postings report (read-only) — target ${process.env.CYCLE_COUNT_REPORT_ENV}${r.tenant ? `, tenant ${r.tenant}` : ''}`)
  console.log(`Inventory database: ${r.inventory.kind}, fingerprint ${r.inventory.fingerprint}`)
  console.log(`WMS database: ${r.wms.kind}, fingerprint ${r.wms.fingerprint}`)
  console.log('The two databases are read one after the other, not as one snapshot.\n')
  console.log('Summary (counts with unkeyed cycle-count postings):')
  for (const c of ORDER) console.log(`  ${c.padEnd(24)} ${r.summary[c]}`)
  console.log(`  Pending counts with no historical postings: ${r.pendingCountsWithoutHistoricalPostings}`)

  const shown = [...r.findings].sort((a, b) => ORDER.indexOf(a.classification) - ORDER.indexOf(b.classification))
  for (const f of shown) {
    console.log(`\n[${f.classification}] count ${f.countId} (status ${f.status ?? 'not found'}, tenant ${f.tenantId ?? '?'})`)
    console.log(`  ${f.entries.length} posting(s), ${f.unreviewed} unreviewed, from ${f.attempts} approval attempt(s)`)
    for (const p of f.problems) console.log(`  ! ${p}`)
    for (const e of f.entries) {
      console.log(
        `  - entry ${e.entryId}  sku ${e.skuId}  warehouse ${e.warehouseId}${e.batchId ? `  batch ${e.batchId}` : ''}  delta ${e.quantityDelta}  at ${e.occurredAt}  correlation ${e.correlationId}`,
      )
      if (e.recordedOnLineId) console.log(`      reviewed: recorded on line ${e.recordedOnLineId}`)
      else if (e.candidateLineId) console.log(`      only candidate: line ${e.candidateLineId}`)
      for (const p of e.problems) console.log(`      ! ${p}`)
    }
  }
  const open = r.findings.filter((f) => f.classification !== 'NO_HISTORICAL_POSTINGS').length
  console.log(
    open
      ? `\n${open} count(s) need a review before approval (see --help for the manual procedure); this script changes nothing.`
      : '\nNothing to review.',
  )
}

async function run(args: Args): Promise<number> {
  // Captured before Prisma loads, so .env files picked up by Prisma cannot redirect the report.
  const invUrl = process.env.INVENTORY_DATABASE_URL?.trim()
  const wmsUrl = process.env.WMS_DATABASE_URL?.trim()
  if (!invUrl || !wmsUrl) throw new RefusedError('INVENTORY_DATABASE_URL and WMS_DATABASE_URL must be set explicitly in the environment')
  const invFp = databaseFingerprint('INVENTORY_DATABASE_URL', invUrl)
  const wmsFp = databaseFingerprint('WMS_DATABASE_URL', wmsUrl)
  assertTargetAllowed(args, invFp, wmsFp)

  const report = await collect(args, invUrl, invFp, wmsUrl, wmsFp)
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else printText(report)
  return report.findings.some((f) => f.classification !== 'NO_HISTORICAL_POSTINGS') ? EXIT_FINDINGS : EXIT_OK
}

async function main(): Promise<number> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`${(e as Error).message}\n\nRun with --help for safe usage.`)
    return EXIT_USAGE
  }
  if (args.help) {
    console.log(HELP)
    return EXIT_OK
  }
  try {
    return await run(args)
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`Usage error: ${e.message}`)
      return EXIT_USAGE
    }
    if (e instanceof RefusedError) {
      console.error(`REFUSED: ${e.message}. Nothing was read.`)
      return EXIT_REFUSED
    }
    // Prisma errors can echo connection details; print only their class and code.
    const err = e as { name?: string; code?: string; message?: string }
    const detail = err.name?.startsWith('PrismaClient') ? `${err.name}${err.code ? ` (${err.code})` : ''}` : (err.message ?? 'Error')
    console.error(`FAILED: ${detail}`)
    return EXIT_FINDINGS
  }
}

main().then((code) => process.exit(code))
