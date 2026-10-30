/**
 * Read-only preflight for deploying the bank-reconciliation ledger schema (finding F-4 of
 * ticket-analysis/outputs/bank-reconciliation-final-review.md).
 *
 *   npx tsx scripts/bank-reconciliation-schema-preflight.ts --help
 *
 * Deploying runs `prisma db push --accept-data-loss` (scripts/start-server.mjs → migrate-all.ts),
 * and a failed push stops a production server. This script reports, before that happens, the rows
 * that would make the new constraints fail or that change meaning under the new workflow:
 *
 *   1. duplicate non-null BankAccount.chartAccountId per tenant (new @@unique) .......... BLOCKER
 *   2. overlapping reconciliation periods per bank account (if the tables exist) ......... BLOCKER
 *   3. statement lines without a dedupe key ............................................. INFO
 *   4. lines reconciled by the retired line-only workflow ............................... INFO
 *   5. rows that would violate the new foreign keys or unique indexes .................... BLOCKER
 *
 * It is read-only by design: SELECT statements only, inside a READ ONLY transaction on Postgres and
 * with PRAGMA query_only on SQLite. It never repairs data and never changes the schema. Output is
 * counts and record ids only: never URLs, credentials, tokens, names, descriptions, amounts or
 * account numbers. Production is refused unless separately reviewed and explicitly authorized.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

const SCRIPT = 'scripts/bank-reconciliation-schema-preflight.ts'
const PROD_ENV_KEYS = ['RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_ENVIRONMENT', 'RENDER_SERVICE_NAME', 'APP_ENV', 'PLEROS_ENV']
const ALLOWED_ENVS = new Set(['local', 'staging', 'production'])
const APPROVAL_RE = /^[A-Z][A-Z0-9]+-\d+$/
const MAX_IDS = 20

const EXIT_OK = 0
const EXIT_BLOCKERS = 1
const EXIT_REFUSED = 2
const EXIT_USAGE = 64

const HELP = `Usage: npx tsx ${SCRIPT} [options]

Read-only checks of the LEDGER database before the bank-reconciliation schema is applied.
Never writes, repairs or migrates anything.

Environment (set explicitly in the shell; .env files are not used):
  BANK_RECON_PREFLIGHT_ENV=local|staging|production   Required; declares the target
  LEDGER_DATABASE_URL                                 Ledger database to inspect
  BANK_RECON_PRODUCTION_DB_FINGERPRINTS               Optional comma list; refused unless production is authorized

Options:
  --expect-db-fingerprint <hex>     Refuse unless LEDGER_DATABASE_URL has this fingerprint
  --production-approval <TICKET-1>  Required (with BANK_RECON_PREFLIGHT_ENV=production) to run against
                                    production after a separate review; also needs --expect-db-fingerprint
  --help                            Show this help

Exit codes: 0 no blockers, 1 blockers found or failure, 2 refused by a safety check, 64 usage error.
Output contains only counts, record ids and a database fingerprint.`

class UsageError extends Error {}
class RefusedError extends Error {}

type Args = { help: boolean; expectDbFingerprint?: string; productionApproval?: string }

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--expect-db-fingerprint' || arg === '--production-approval') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new UsageError(`Missing value for ${arg}`)
      const key = arg === '--expect-db-fingerprint' ? 'expectDbFingerprint' : 'productionApproval'
      if (args[key] !== undefined) throw new UsageError(`${arg} given more than once`)
      args[key] = value
      i++
    } else throw new UsageError(`Unknown argument "${arg}"`)
  }
  return args
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** Identifies a database without credentials: hash of scheme, host, port and database path. */
function databaseFingerprint(url: string): { kind: 'sqlite' | 'postgresql'; fingerprint: string; nameHint: string } {
  if (url.startsWith('file:')) {
    const file = path.resolve(url.slice('file:'.length).split('?')[0]!)
    return { kind: 'sqlite', fingerprint: sha256(`sqlite|${file.toLowerCase()}`).slice(0, 16), nameHint: path.basename(file) }
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new RefusedError('LEDGER_DATABASE_URL is not parseable (value not shown)')
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new RefusedError(`Unsupported database scheme ${u.protocol}`)
  const host = u.hostname.toLowerCase()
  const db = u.pathname.replace(/^\//, '')
  return { kind: 'postgresql', fingerprint: sha256(`postgresql|${host}|${u.port || '5432'}|${db}`).slice(0, 16), nameHint: `${host}|${db}` }
}

/** Refuses production unless it was declared, reviewed (approval reference) and bound to a fingerprint. */
function assertTargetAllowed(args: Args, fp: ReturnType<typeof databaseFingerprint>) {
  const env = process.env.BANK_RECON_PREFLIGHT_ENV ?? ''
  if (!ALLOWED_ENVS.has(env)) throw new RefusedError('BANK_RECON_PREFLIGHT_ENV must be local, staging or production')
  const deniedFps = new Set(
    (process.env.BANK_RECON_PRODUCTION_DB_FINGERPRINTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
  const signals = [
    ...PROD_ENV_KEYS.filter((k) => /prod/i.test(process.env[k] ?? '')).map((k) => `${k} indicates production`),
    ...(/prod/i.test(fp.nameHint) ? ['database host or name indicates production'] : []),
    ...(deniedFps.has(fp.fingerprint) ? ['database fingerprint is listed as production'] : []),
  ]
  if (args.expectDbFingerprint && args.expectDbFingerprint.toLowerCase() !== fp.fingerprint) {
    throw new RefusedError('--expect-db-fingerprint does not match LEDGER_DATABASE_URL')
  }
  if (env !== 'production') {
    if (signals.length) throw new RefusedError(`${signals[0]}; production needs a separate review (see --help)`)
    if (args.productionApproval) throw new UsageError('--production-approval is only valid with BANK_RECON_PREFLIGHT_ENV=production')
    return
  }
  if (!args.productionApproval || !APPROVAL_RE.test(args.productionApproval)) {
    throw new RefusedError('Production needs --production-approval <TICKET-123> from the separate review')
  }
  if (!args.expectDbFingerprint) throw new RefusedError('Production needs --expect-db-fingerprint of the reviewed database')
}

// ---------------------------------------------------------------------------------------------
// Database phase. Prisma is loaded only here, after every offline check has passed.

type Row = Record<string, unknown>
type Query = (sql: string, ...params: unknown[]) => Promise<Row[]>
type Finding = { check: string; level: 'BLOCKER' | 'INFO' | 'PASS' | 'SKIPPED'; count: number; detail: string; ids?: string[] }

const q = (name: string) => `"${name}"`
const num = (v: unknown) => Number(v ?? 0)

async function tableExists(query: Query, kind: string, table: string): Promise<boolean> {
  const rows =
    kind === 'sqlite'
      ? await query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table)
      : await query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`, table)
  return rows.length > 0
}

async function columnExists(query: Query, kind: string, table: string, column: string): Promise<boolean> {
  const rows =
    kind === 'sqlite'
      ? await query(`SELECT name FROM pragma_table_info(?) WHERE name = ?`, table, column)
      : await query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
          table,
          column,
        )
  return rows.length > 0
}

/** One finding from a "rows that violate X" query that returns an `id` column (capped). */
async function violations(query: Query, check: string, sql: string, detail: string): Promise<Finding> {
  const rows = await query(`${sql} LIMIT ${MAX_IDS + 1}`)
  const countRows = await query(`SELECT COUNT(*) AS n FROM (${sql}) v`)
  const count = num(countRows[0]?.n)
  return { check, level: count ? 'BLOCKER' : 'PASS', count, detail, ids: rows.slice(0, MAX_IDS).map((r) => String(r.id)) }
}

async function runChecks(query: Query, kind: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const has = async (t: string) => tableExists(query, kind, t)
  const hasCol = async (t: string, c: string) => columnExists(query, kind, t, c)
  const [recon, match, item, event, imp] = await Promise.all([
    has('BankReconciliation'),
    has('BankReconciliationMatch'),
    has('BankReconciliationMatchItem'),
    has('BankReconciliationEvent'),
    has('BankStatementImport'),
  ])
  const [hasDedupe, hasImportId] = await Promise.all([hasCol('BankStatementLine', 'dedupeKey'), hasCol('BankStatementLine', 'importId')])
  const BA = q('BankAccount')
  const SL = q('BankStatementLine')

  // 1. One GL cash account per bank account (new @@unique([tenantId, chartAccountId])).
  findings.push(
    await violations(
      query,
      '1. Duplicate BankAccount.chartAccountId per tenant',
      `SELECT a.${q('id')} AS id FROM ${BA} a JOIN (
         SELECT ${q('tenantId')} AS t, ${q('chartAccountId')} AS c FROM ${BA}
         WHERE ${q('chartAccountId')} IS NOT NULL GROUP BY ${q('tenantId')}, ${q('chartAccountId')} HAVING COUNT(*) > 1
       ) d ON d.t = a.${q('tenantId')} AND d.c = a.${q('chartAccountId')} ORDER BY a.${q('id')}`,
      'bank accounts sharing a GL account with another account of the same tenant; the unique index cannot be created',
    ),
  )

  // 2. Overlapping periods (only once the reconciliation tables exist).
  if (recon) {
    const R = q('BankReconciliation')
    findings.push(
      await violations(
        query,
        '2. Overlapping reconciliation periods per bank account',
        `SELECT a.${q('id')} AS id FROM ${R} a JOIN ${R} b
           ON a.${q('tenantId')} = b.${q('tenantId')} AND a.${q('bankAccountId')} = b.${q('bankAccountId')} AND a.${q('id')} <> b.${q('id')}
          AND a.${q('periodStart')} <= b.${q('periodEnd')} AND b.${q('periodStart')} <= a.${q('periodEnd')}
         GROUP BY a.${q('id')} ORDER BY a.${q('id')}`,
        'reconciliations whose statement period overlaps another period of the same account',
      ),
    )
  } else {
    findings.push({ check: '2. Overlapping reconciliation periods per bank account', level: 'SKIPPED', count: 0, detail: 'BankReconciliation table not created yet (expected before deploy)' })
  }

  // 3. Lines without a dedupe key: CSV re-imports cannot recognize them as duplicates (L-5).
  const noKey = await query(`SELECT COUNT(*) AS n FROM ${SL}${hasDedupe ? ` WHERE ${q('dedupeKey')} IS NULL` : ''}`)
  const byAccount = await query(
    `SELECT ${q('bankAccountId')} AS id, COUNT(*) AS n FROM ${SL}${hasDedupe ? ` WHERE ${q('dedupeKey')} IS NULL` : ''}
     GROUP BY ${q('bankAccountId')} ORDER BY ${q('bankAccountId')} LIMIT ${MAX_IDS}`,
  )
  findings.push({
    check: '3. Statement lines without a dedupe key',
    level: 'INFO',
    count: num(noKey[0]?.n),
    detail: `${hasDedupe ? 'dedupeKey IS NULL' : 'dedupeKey column not created yet, so every existing line'}; a CSV import of the same transactions would add them again. Per bank account: ${byAccount.map((r) => `${r.id}=${num(r.n)}`).join(', ') || 'none'}`,
  })

  // 4. Retired line-only reconcile: these amounts are already inside BankAccount.currentBalance.
  const retired = await query(
    `SELECT ${q('bankAccountId')} AS id, COUNT(*) AS n FROM ${SL} WHERE ${q('reconciled')} = ${kind === 'sqlite' ? '1' : 'true'}
     GROUP BY ${q('bankAccountId')} ORDER BY ${q('bankAccountId')}`,
  )
  findings.push({
    check: '4. Lines reconciled by the retired line-only workflow',
    level: 'INFO',
    count: retired.reduce((n, r) => n + num(r.n), 0),
    detail: `reconciled = true; their amounts were added to BankAccount.currentBalance and stay out of new-workflow matching state. Per bank account: ${retired.slice(0, MAX_IDS).map((r) => `${r.id}=${num(r.n)}`).join(', ') || 'none'}`,
  })

  // 5. Foreign keys and unique indexes of the new schema.
  const fk = async (check: string, sql: string, detail: string) => findings.push(await violations(query, check, sql, detail))
  await fk('5a. Statement lines whose bank account does not exist', `SELECT l.${q('id')} AS id FROM ${SL} l LEFT JOIN ${BA} a ON a.${q('id')} = l.${q('bankAccountId')} WHERE a.${q('id')} IS NULL ORDER BY l.${q('id')}`, 'BankStatementLine.bankAccountId → BankAccount')
  await fk(
    '5b. Bank accounts linked to a missing or other-tenant GL account',
    `SELECT a.${q('id')} AS id FROM ${BA} a LEFT JOIN ${q('ChartAccount')} c ON c.${q('id')} = a.${q('chartAccountId')} AND c.${q('tenantId')} = a.${q('tenantId')}
     WHERE a.${q('chartAccountId')} IS NOT NULL AND c.${q('id')} IS NULL ORDER BY a.${q('id')}`,
    'not a database constraint, but such accounts cannot be reconciled (book side unknown)',
  )
  if (hasDedupe) {
    await fk(
      '5c. Duplicate (tenantId, bankAccountId, dedupeKey)',
      `SELECT l.${q('id')} AS id FROM ${SL} l JOIN (SELECT ${q('tenantId')} AS t, ${q('bankAccountId')} AS b, ${q('dedupeKey')} AS k FROM ${SL}
         WHERE ${q('dedupeKey')} IS NOT NULL GROUP BY ${q('tenantId')}, ${q('bankAccountId')}, ${q('dedupeKey')} HAVING COUNT(*) > 1) d
       ON d.t = l.${q('tenantId')} AND d.b = l.${q('bankAccountId')} AND d.k = l.${q('dedupeKey')} ORDER BY l.${q('id')}`,
      'new unique index on statement lines',
    )
  }
  if (hasImportId && imp) {
    await fk('5d. Statement lines whose import does not exist', `SELECT l.${q('id')} AS id FROM ${SL} l LEFT JOIN ${q('BankStatementImport')} i ON i.${q('id')} = l.${q('importId')} WHERE l.${q('importId')} IS NOT NULL AND i.${q('id')} IS NULL ORDER BY l.${q('id')}`, 'BankStatementLine.importId → BankStatementImport')
  }
  if (imp) {
    const I = q('BankStatementImport')
    await fk('5e. Statement imports whose bank account does not exist', `SELECT i.${q('id')} AS id FROM ${I} i LEFT JOIN ${BA} a ON a.${q('id')} = i.${q('bankAccountId')} WHERE a.${q('id')} IS NULL ORDER BY i.${q('id')}`, 'BankStatementImport.bankAccountId → BankAccount')
  }
  if (recon) {
    const R = q('BankReconciliation')
    await fk('5f. Reconciliations whose bank account does not exist', `SELECT r.${q('id')} AS id FROM ${R} r LEFT JOIN ${BA} a ON a.${q('id')} = r.${q('bankAccountId')} WHERE a.${q('id')} IS NULL ORDER BY r.${q('id')}`, 'BankReconciliation.bankAccountId → BankAccount')
    await fk(
      '5g. Duplicate (tenantId, bankAccountId, periodEnd)',
      `SELECT r.${q('id')} AS id FROM ${R} r JOIN (SELECT ${q('tenantId')} AS t, ${q('bankAccountId')} AS b, ${q('periodEnd')} AS e FROM ${R}
         GROUP BY ${q('tenantId')}, ${q('bankAccountId')}, ${q('periodEnd')} HAVING COUNT(*) > 1) d
       ON d.t = r.${q('tenantId')} AND d.b = r.${q('bankAccountId')} AND d.e = r.${q('periodEnd')} ORDER BY r.${q('id')}`,
      'unique period end per bank account',
    )
  }
  if (match && recon) {
    await fk('5h. Matches whose reconciliation does not exist', `SELECT m.${q('id')} AS id FROM ${q('BankReconciliationMatch')} m LEFT JOIN ${q('BankReconciliation')} r ON r.${q('id')} = m.${q('reconciliationId')} WHERE r.${q('id')} IS NULL ORDER BY m.${q('id')}`, 'BankReconciliationMatch.reconciliationId → BankReconciliation')
  }
  if (item) {
    const MI = q('BankReconciliationMatchItem')
    if (match) {
      await fk('5i. Match items whose match does not exist', `SELECT i.${q('id')} AS id FROM ${MI} i LEFT JOIN ${q('BankReconciliationMatch')} m ON m.${q('id')} = i.${q('matchId')} WHERE m.${q('id')} IS NULL ORDER BY i.${q('id')}`, 'BankReconciliationMatchItem.matchId → BankReconciliationMatch')
    }
    await fk('5j. Match items whose statement line does not exist', `SELECT i.${q('id')} AS id FROM ${MI} i LEFT JOIN ${SL} l ON l.${q('id')} = i.${q('statementLineId')} WHERE i.${q('statementLineId')} IS NOT NULL AND l.${q('id')} IS NULL ORDER BY i.${q('id')}`, 'BankReconciliationMatchItem.statementLineId → BankStatementLine')
    await fk('5k. Match items whose journal line does not exist', `SELECT i.${q('id')} AS id FROM ${MI} i LEFT JOIN ${q('JournalLine')} j ON j.${q('id')} = i.${q('journalLineId')} WHERE i.${q('journalLineId')} IS NOT NULL AND j.${q('id')} IS NULL ORDER BY i.${q('id')}`, 'BankReconciliationMatchItem.journalLineId → JournalLine')
    for (const col of ['activeStatementLineId', 'activeJournalLineId']) {
      await fk(
        `5l. Duplicate ${col}`,
        `SELECT i.${q('id')} AS id FROM ${MI} i JOIN (SELECT ${q(col)} AS v FROM ${MI} WHERE ${q(col)} IS NOT NULL GROUP BY ${q(col)} HAVING COUNT(*) > 1) d ON d.v = i.${q(col)} ORDER BY i.${q('id')}`,
        'an item may be actively matched only once (unique index)',
      )
    }
  }
  if (event && recon) {
    await fk('5m. Events whose reconciliation does not exist', `SELECT e.${q('id')} AS id FROM ${q('BankReconciliationEvent')} e LEFT JOIN ${q('BankReconciliation')} r ON r.${q('id')} = e.${q('reconciliationId')} WHERE e.${q('reconciliationId')} IS NOT NULL AND r.${q('id')} IS NULL ORDER BY e.${q('id')}`, 'BankReconciliationEvent.reconciliationId → BankReconciliation')
  }
  return findings
}

async function run(args: Args): Promise<number> {
  // Captured before Prisma loads, so .env files picked up by Prisma cannot redirect the check.
  const url = process.env.LEDGER_DATABASE_URL?.trim()
  if (!url) throw new RefusedError('LEDGER_DATABASE_URL must be set explicitly in the environment')
  const fp = databaseFingerprint(url)
  assertTargetAllowed(args, fp)
  console.log(`Bank reconciliation schema preflight (read-only) — target ${process.env.BANK_RECON_PREFLIGHT_ENV}`)
  console.log(`Ledger database: ${fp.kind}, fingerprint ${fp.fingerprint}`)

  const { PrismaClient } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../apps/web/generated/prisma-ledger') as typeof import('../apps/web/generated/prisma-ledger')
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] })
  try {
    // One transaction pins one connection; its first statement makes that connection read-only.
    const findings = await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(fp.kind === 'sqlite' ? 'PRAGMA query_only = ON' : 'SET TRANSACTION READ ONLY')
        return runChecks((sql, ...p) => tx.$queryRawUnsafe<Row[]>(sql, ...p), fp.kind)
      },
      { maxWait: 10_000, timeout: 120_000 },
    )
    for (const f of findings) {
      console.log(`\n[${f.level}] ${f.check}: ${f.count}`)
      console.log(`  ${f.detail}`)
      if (f.ids?.length) console.log(`  ids${f.count > f.ids.length ? ` (first ${f.ids.length})` : ''}: ${f.ids.join(', ')}`)
    }
    const blockers = findings.filter((f) => f.level === 'BLOCKER')
    console.log(
      blockers.length
        ? `\n${blockers.length} BLOCKER check(s) failed. Do not deploy the schema until each is resolved and reviewed; this script repairs nothing.`
        : '\nNo blockers. INFO items need a review decision, not a repair.',
    )
    return blockers.length ? EXIT_BLOCKERS : EXIT_OK
  } finally {
    await db.$disconnect()
  }
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
    return EXIT_BLOCKERS
  }
}

main().then((code) => process.exit(code))
