/**
 * Remove the synthetic ledger records created by the BANKTEST bank-reconciliation manual tests.
 *
 *   npx tsx scripts/cleanup-banktest-reconciliation.ts --help
 *
 * Input is a reviewed JSON manifest listing the exact record ids captured during the test run.
 * Nothing is matched by free text: every id must be listed, belong to the supplied tenant and
 * carry the BANKTEST naming convention where the table has a name or description.
 *
 * Covers the bank-reconciliation tables too: reconciliations, matches (their items are derived and
 * must only touch manifest records), statement imports and reconciliation events. Every child of a
 * listed parent must itself be listed, so a foreign key or cascade can never remove an unlisted row.
 *
 * Dry-run is the default. Deletion needs --execute plus a staging confirmation value, the
 * fingerprint of the ledger database seen during dry-run, and the sha256 of the reviewed manifest.
 *
 * Only the ledger database is modified (one transaction). Records in other databases (invoices,
 * orders, vendor bills, audit events) are reported as out of scope and never touched. Auto-posted
 * AR/AP payment journal entries are refused: deleting them would leave Invoice/Order/VendorBill
 * amountPaid (other databases) disagreeing with the GL, and no cross-database restore is atomic.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

const SCRIPT = 'scripts/cleanup-banktest-reconciliation.ts'
const PREFIX = 'BANKTEST'
const TEST_RUN_ID_RE = /^BANKTEST-\d{8}-\d{3}$/
// Tenant ids have no @default in the tenant schema, so allow cuid/uuid/slug-like ids, nothing else.
const TENANT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/
// Ledger ids are Prisma cuid() values.
const RECORD_ID_RE = /^c[a-z0-9]{20,31}$/
const PLACEHOLDER_IDS = new Set(['exact-tenant-id', 'tenant-id', 'your-tenant-id', 'changeme'])
const MAX_IDS_PER_LIST = 200
const PROD_ENV_KEYS = ['RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_ENVIRONMENT', 'RENDER_SERVICE_NAME', 'APP_ENV', 'PLEROS_ENV']

const EXIT_OK = 0
const EXIT_FAILED = 1
const EXIT_REFUSED = 2
const EXIT_USAGE = 64

const HELP = `Usage: npx tsx ${SCRIPT} --manifest <file> --tenant-id <id> --test-run-id <id> [options]

Removes BANKTEST bank-reconciliation test records from the LEDGER database only.
Default mode is a read-only dry-run.

Required:
  --manifest <file>            Reviewed JSON manifest of exact record ids (see below)
  --tenant-id <id>             Must equal manifest.tenantId
  --test-run-id <id>           Must equal manifest.testRunId, format BANKTEST-YYYYMMDD-NNN

Modes:
  (default)                    Dry-run: validate, print candidate counts, change nothing
  --check-manifest             Validate arguments and manifest offline; never connects to a database
  --execute                    Delete, in one transaction (requires all of the following)
    --confirm-staging <value>          Must be exactly DELETE-STAGING-<test-run-id>
    --expect-db-fingerprint <hex>      Ledger DB fingerprint printed by the dry-run
    --approved-manifest-sha256 <hex>   Manifest sha256 printed by the dry-run
  --help                       Show this help

Environment (set explicitly in the shell; .env files are not used):
  BANKTEST_CLEANUP_ENV=staging          Required for any database mode
  LEDGER_DATABASE_URL                   Ledger database (records are deleted here)
  TENANT_DATABASE_URL                   Tenant database (read-only check that the tenant is a BANKTEST tenant)
  BANKTEST_PRODUCTION_DB_FINGERPRINTS   Optional comma list of fingerprints that are always refused

Manifest:
  {
    "tenantId": "<exact tenant id>",
    "testRunId": "BANKTEST-YYYYMMDD-NNN",
    "bankAccountIds": [],              deleted; name must start with BANKTEST, no Plaid link
    "reconciliationIds": [],           deleted; bank account must be listed too
    "matchIds": [],                    deleted with their items; reconciliation must be listed
    "statementImportIds": [],          deleted; every line of the import must be listed
    "reconciliationEventIds": [],      deleted; reconciliation or bank account must be listed
    "statementLineIds": [],            deleted; description must start with BANKTEST
    "journalEntryIds": [],             deleted with their lines; description must start with BANKTEST
    "unprefixedJournalEntryIds": [],   must be empty: auto-posted AR/AP payment entries are refused
    "chartAccountIds": [],             reported only, never deleted
    "paymentIds": [],                  reported only (order/purchasing databases are out of scope)
    "otherRecordIds": []               reported only
  }
  Every reconciliation, match, import and event of a listed bank account (and every match and
  event of a listed reconciliation) must be listed; unlisted children make the plan refuse.

Exit codes: 0 success, 1 failure or verification mismatch, 2 refused by a safety check, 64 usage error.
Output never includes database URLs, credentials, names, descriptions, amounts or account numbers.`

class UsageError extends Error {}
class RefusedError extends Error {}

type Args = {
  manifest?: string
  tenantId?: string
  testRunId?: string
  execute: boolean
  checkManifest: boolean
  help: boolean
  confirmStaging?: string
  expectDbFingerprint?: string
  approvedManifestSha256?: string
}

const VALUE_FLAGS: Record<string, keyof Args> = {
  '--manifest': 'manifest',
  '--tenant-id': 'tenantId',
  '--test-run-id': 'testRunId',
  '--confirm-staging': 'confirmStaging',
  '--expect-db-fingerprint': 'expectDbFingerprint',
  '--approved-manifest-sha256': 'approvedManifestSha256',
}

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false, checkManifest: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--execute') args.execute = true
    else if (arg === '--check-manifest') args.checkManifest = true
    else if (arg in VALUE_FLAGS) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new UsageError(`Missing value for ${arg}`)
      const key = VALUE_FLAGS[arg]!
      if (args[key] !== undefined) throw new UsageError(`${arg} given more than once`)
      ;(args as Record<string, unknown>)[key] = value
      i++
    } else throw new UsageError(`Unknown argument "${arg}"`)
  }
  if (args.help) return args
  if (args.execute && args.checkManifest) throw new UsageError('--execute and --check-manifest are mutually exclusive')
  for (const flag of ['--manifest', '--tenant-id', '--test-run-id']) {
    if (!args[VALUE_FLAGS[flag]!]) throw new UsageError(`${flag} is required`)
  }
  if (!args.execute) {
    for (const flag of ['--confirm-staging', '--expect-db-fingerprint', '--approved-manifest-sha256']) {
      if (args[VALUE_FLAGS[flag]!] !== undefined) throw new UsageError(`${flag} is only valid with --execute`)
    }
  }
  return args
}

function validateTenantId(id: string): string {
  if (id !== id.trim() || !TENANT_ID_RE.test(id) || PLACEHOLDER_IDS.has(id.toLowerCase())) {
    throw new RefusedError('Tenant id is empty, a placeholder, or malformed (wildcards and spaces are refused)')
  }
  return id
}

function validateTestRunId(id: string): string {
  if (!TEST_RUN_ID_RE.test(id)) throw new RefusedError('Test-run id must match BANKTEST-YYYYMMDD-NNN exactly')
  return id
}

type Manifest = {
  tenantId: string
  testRunId: string
  bankAccountIds: string[]
  reconciliationIds: string[]
  matchIds: string[]
  statementImportIds: string[]
  reconciliationEventIds: string[]
  statementLineIds: string[]
  journalEntryIds: string[]
  unprefixedJournalEntryIds: string[]
  chartAccountIds: string[]
  paymentIds: string[]
  otherRecordIds: string[]
}

const DELETABLE_LISTS = [
  'bankAccountIds',
  'reconciliationIds',
  'matchIds',
  'statementImportIds',
  'reconciliationEventIds',
  'statementLineIds',
  'journalEntryIds',
  'unprefixedJournalEntryIds',
] as const
const REPORT_ONLY_LISTS = ['chartAccountIds', 'paymentIds', 'otherRecordIds'] as const
const MANIFEST_KEYS = new Set<string>(['tenantId', 'testRunId', ...DELETABLE_LISTS, ...REPORT_ONLY_LISTS])

function validateManifest(raw: unknown, tenantId: string, testRunId: string): Manifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RefusedError('Manifest must be a JSON object')
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(obj)) {
    if (!MANIFEST_KEYS.has(key)) throw new RefusedError(`Manifest has unknown key "${key}"`)
  }
  if (obj.tenantId !== tenantId) throw new RefusedError('manifest.tenantId does not equal --tenant-id')
  if (obj.testRunId !== testRunId) throw new RefusedError('manifest.testRunId does not equal --test-run-id')

  const manifest = { tenantId, testRunId } as Manifest
  const seen = new Set<string>()
  for (const key of [...DELETABLE_LISTS, ...REPORT_ONLY_LISTS]) {
    const value = obj[key] ?? []
    if (!Array.isArray(value)) throw new RefusedError(`manifest.${key} must be an array`)
    if (value.length > MAX_IDS_PER_LIST) throw new RefusedError(`manifest.${key} has more than ${MAX_IDS_PER_LIST} ids`)
    const isLedgerList = (DELETABLE_LISTS as readonly string[]).includes(key) || key === 'chartAccountIds'
    for (const id of value) {
      if (typeof id !== 'string') throw new RefusedError(`manifest.${key} contains a non-string id`)
      // Report-only lists may hold ids from other databases, but still never wildcards or blanks.
      const ok = isLedgerList ? RECORD_ID_RE.test(id) : TENANT_ID_RE.test(id)
      if (!ok) throw new RefusedError(`manifest.${key} contains a malformed id (${sanitize(id)})`)
      if (seen.has(id)) throw new RefusedError(`Id ${id} appears more than once in the manifest`)
      seen.add(id)
    }
    manifest[key] = value as string[]
  }
  if (DELETABLE_LISTS.every((key) => manifest[key].length === 0)) {
    throw new RefusedError('Manifest lists no deletable ids')
  }
  if (manifest.unprefixedJournalEntryIds.length) {
    // Their invoices, orders and vendor bills keep amountPaid in other databases; deleting the GL side
    // alone would leave the ledger and the sub-ledgers disagreeing, and no restore spans both atomically.
    throw new RefusedError(
      'Deleting auto-posted AR/AP payment journal entries is not supported (the order and purchasing databases keep amountPaid); leave unprefixedJournalEntryIds empty and keep those entries',
    )
  }
  return manifest
}

/** Only for error messages about rejected ids: keep it short and printable. */
function sanitize(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9-]/g, '?')
  return clean.length > 12 ? `${clean.slice(0, 12)}…` : clean
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Identifies a database without credentials: hash of scheme, host, port and database path. */
function databaseFingerprint(url: string): { kind: string; fingerprint: string; nameHint: string } {
  if (url.startsWith('file:')) {
    const file = path.resolve(url.slice('file:'.length).split('?')[0]!)
    return { kind: 'sqlite', fingerprint: sha256(`sqlite|${file.toLowerCase()}`).slice(0, 16), nameHint: path.basename(file) }
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new RefusedError('Database URL is not parseable (value not shown)')
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new RefusedError(`Unsupported database scheme ${u.protocol}`)
  }
  const host = u.hostname.toLowerCase()
  const port = u.port || '5432'
  const db = u.pathname.replace(/^\//, '')
  return { kind: 'postgresql', fingerprint: sha256(`postgresql|${host}|${port}|${db}`).slice(0, 16), nameHint: `${host}|${db}` }
}

function readDatabaseUrl(envKey: string): string {
  const url = process.env[envKey]?.trim()
  if (!url) throw new RefusedError(`${envKey} must be set explicitly in the environment`)
  return url
}

function assertNotProduction(urls: Record<string, string>) {
  if (process.env.BANKTEST_CLEANUP_ENV !== 'staging') {
    throw new RefusedError('BANKTEST_CLEANUP_ENV must be exactly "staging"')
  }
  for (const key of PROD_ENV_KEYS) {
    if (/prod/i.test(process.env[key] ?? '')) throw new RefusedError(`${key} indicates a production environment`)
  }
  const denied = new Set(
    (process.env.BANKTEST_PRODUCTION_DB_FINGERPRINTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
  for (const [key, url] of Object.entries(urls)) {
    const { fingerprint, nameHint } = databaseFingerprint(url)
    if (/prod/i.test(nameHint)) throw new RefusedError(`${key} host or database name indicates production`)
    if (denied.has(fingerprint)) throw new RefusedError(`${key} matches a production fingerprint`)
  }
}

// ---------------------------------------------------------------------------------------------
// Database phase. Prisma clients are only loaded here, after every offline check has passed.

type LedgerClient = InstanceType<typeof import('../apps/web/generated/prisma-ledger').PrismaClient>
type LedgerTx = Omit<LedgerClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>
type TenantClient = InstanceType<typeof import('../apps/web/generated/prisma-tenant').PrismaClient>

type Plan = {
  problems: string[]
  warnings: string[]
  bankAccountIds: string[]
  reconciliationIds: string[]
  matchIds: string[]
  matchItemIds: string[]
  statementImportIds: string[]
  reconciliationEventIds: string[]
  statementLineIds: string[]
  journalEntryIds: string[]
  journalLineCount: number
}

/** Children before parents: the order of deletePlan and of the printed tables. */
const TABLES = [
  'BankReconciliationMatchItem',
  'BankReconciliationMatch',
  'BankReconciliationEvent',
  'BankStatementLine',
  'BankStatementImport',
  'BankReconciliation',
  'BankAccount',
  'JournalLine',
  'JournalEntry',
] as const
type Counts = Record<(typeof TABLES)[number], number>
const ZERO_COUNTS = Object.fromEntries(TABLES.map((t) => [t, 0])) as Counts
const DAY_MS = 86_400_000

/** Validates every manifest id against the tenant. Read-only; runs before and inside the transaction. */
async function buildPlan(db: LedgerTx, m: Manifest): Promise<Plan> {
  const problems: string[] = []
  const warnings: string[] = []
  const tenantId = m.tenantId
  const accountSet = new Set(m.bankAccountIds)
  const reconSet = new Set(m.reconciliationIds)
  const lineSet = new Set(m.statementLineIds)
  const allJeIds = [...m.journalEntryIds, ...m.unprefixedJournalEntryIds]
  const jeSet = new Set(allJeIds)
  const unlisted = (table: string, id: string, parent: string) =>
    problems.push(`${table} ${id}: belongs to ${parent} but is missing from the manifest`)

  // Bank accounts — looked up by id alone so a wrong-tenant id is reported, never deleted.
  const accounts = await db.bankAccount.findMany({
    where: { id: { in: m.bankAccountIds } },
    select: { id: true, tenantId: true, name: true, plaidItemId: true, plaidAccessTokenEncrypted: true },
  })
  const accountById = new Map(accounts.map((a) => [a.id, a]))
  for (const id of m.bankAccountIds) {
    const a = accountById.get(id)
    if (!a) problems.push(`BankAccount ${id}: not found`)
    else if (a.tenantId !== tenantId) problems.push(`BankAccount ${id}: belongs to a different tenant`)
    else if (!a.name.trim().toUpperCase().startsWith(PREFIX)) problems.push(`BankAccount ${id}: name lacks ${PREFIX} prefix`)
    else if (a.plaidItemId || a.plaidAccessTokenEncrypted) {
      problems.push(`BankAccount ${id}: has a Plaid link; unlink it in the app first`)
    }
  }
  // Every child of a listed account must be listed: lines cascade, the others are Restrict.
  if (m.bankAccountIds.length) {
    const scope = { tenantId, bankAccountId: { in: m.bankAccountIds } }
    const [lines, recons, imports, events] = await Promise.all([
      db.bankStatementLine.findMany({ where: { ...scope, id: { notIn: m.statementLineIds } }, select: { id: true, bankAccountId: true }, take: 20 }),
      db.bankReconciliation.findMany({ where: { ...scope, id: { notIn: m.reconciliationIds } }, select: { id: true, bankAccountId: true }, take: 20 }),
      db.bankStatementImport.findMany({ where: { ...scope, id: { notIn: m.statementImportIds } }, select: { id: true, bankAccountId: true }, take: 20 }),
      db.bankReconciliationEvent.findMany({
        where: { ...scope, id: { notIn: m.reconciliationEventIds } },
        select: { id: true, bankAccountId: true },
        take: 20,
      }),
    ])
    for (const l of lines) problems.push(`BankStatementLine ${l.id}: on BankAccount ${l.bankAccountId} but missing from manifest (cascade would remove it)`)
    for (const r of recons) unlisted('BankReconciliation', r.id, `BankAccount ${r.bankAccountId}`)
    for (const i of imports) unlisted('BankStatementImport', i.id, `BankAccount ${i.bankAccountId}`)
    for (const e of events) unlisted('BankReconciliationEvent', e.id, `BankAccount ${e.bankAccountId}`)
  }

  // Reconciliations: only periods of listed accounts (deleting a kept account's period would move its lock).
  const recons = await db.bankReconciliation.findMany({
    where: { id: { in: m.reconciliationIds } },
    select: { id: true, tenantId: true, bankAccountId: true },
  })
  const reconById = new Map(recons.map((r) => [r.id, r]))
  for (const id of m.reconciliationIds) {
    const r = reconById.get(id)
    if (!r) problems.push(`BankReconciliation ${id}: not found`)
    else if (r.tenantId !== tenantId) problems.push(`BankReconciliation ${id}: belongs to a different tenant`)
    else if (!accountSet.has(r.bankAccountId)) problems.push(`BankReconciliation ${id}: its bank account is not in the manifest`)
  }
  if (m.reconciliationIds.length) {
    const scope = { tenantId, reconciliationId: { in: m.reconciliationIds } }
    const [matches, events] = await Promise.all([
      db.bankReconciliationMatch.findMany({ where: { ...scope, id: { notIn: m.matchIds } }, select: { id: true, reconciliationId: true }, take: 20 }),
      db.bankReconciliationEvent.findMany({
        where: { ...scope, id: { notIn: m.reconciliationEventIds } },
        select: { id: true, reconciliationId: true },
        take: 20,
      }),
    ])
    for (const x of matches) unlisted('BankReconciliationMatch', x.id, `BankReconciliation ${x.reconciliationId}`)
    for (const e of events) unlisted('BankReconciliationEvent', e.id, `BankReconciliation ${e.reconciliationId}`)
  }

  // Matches and their items. Items are derived, and may only touch manifest lines or entries.
  const matches = await db.bankReconciliationMatch.findMany({
    where: { id: { in: m.matchIds } },
    select: { id: true, tenantId: true, reconciliationId: true },
  })
  const matchById = new Map(matches.map((x) => [x.id, x]))
  for (const id of m.matchIds) {
    const x = matchById.get(id)
    if (!x) problems.push(`BankReconciliationMatch ${id}: not found`)
    else if (x.tenantId !== tenantId) problems.push(`BankReconciliationMatch ${id}: belongs to a different tenant`)
    else if (!reconSet.has(x.reconciliationId)) problems.push(`BankReconciliationMatch ${id}: its reconciliation is not in the manifest`)
  }
  const items = await db.bankReconciliationMatchItem.findMany({
    where: { matchId: { in: m.matchIds } },
    select: { id: true, tenantId: true, matchId: true, statementLineId: true, journalLine: { select: { id: true, entryId: true } } },
  })
  for (const i of items) {
    if (i.tenantId !== tenantId) problems.push(`BankReconciliationMatchItem ${i.id}: belongs to a different tenant`)
    else if (i.statementLineId && !lineSet.has(i.statementLineId)) {
      problems.push(`BankReconciliationMatchItem ${i.id}: matches BankStatementLine ${i.statementLineId}, which is not in the manifest`)
    } else if (i.journalLine && !jeSet.has(i.journalLine.entryId)) {
      warnings.push(`BankReconciliationMatchItem ${i.id}: matches a line of JournalEntry ${i.journalLine.entryId}, which is kept (it becomes unmatched)`)
    }
  }
  // Match items of unlisted matches that point at manifest lines would block (Restrict) or lose history.
  if (m.statementLineIds.length || allJeIds.length) {
    const foreign = await db.bankReconciliationMatchItem.findMany({
      where: {
        matchId: { notIn: m.matchIds },
        OR: [{ statementLineId: { in: m.statementLineIds } }, { journalLine: { entryId: { in: allJeIds } } }],
      },
      select: { id: true, matchId: true },
      take: 20,
    })
    for (const i of foreign) problems.push(`BankReconciliationMatch ${i.matchId}: matches a manifest record but is missing from the manifest`)
  }

  // Statement imports: every line of the import must be listed (Restrict).
  const imports = await db.bankStatementImport.findMany({
    where: { id: { in: m.statementImportIds } },
    select: { id: true, tenantId: true, bankAccountId: true },
  })
  const importById = new Map(imports.map((i) => [i.id, i]))
  for (const id of m.statementImportIds) {
    const i = importById.get(id)
    if (!i) problems.push(`BankStatementImport ${id}: not found`)
    else if (i.tenantId !== tenantId) problems.push(`BankStatementImport ${id}: belongs to a different tenant`)
  }
  if (m.statementImportIds.length) {
    const lines = await db.bankStatementLine.findMany({
      where: { importId: { in: m.statementImportIds }, id: { notIn: m.statementLineIds } },
      select: { id: true, importId: true },
      take: 20,
    })
    for (const l of lines) unlisted('BankStatementLine', l.id, `BankStatementImport ${l.importId}`)
  }

  // Reconciliation events: audit rows of listed reconciliations or accounts only.
  const events = await db.bankReconciliationEvent.findMany({
    where: { id: { in: m.reconciliationEventIds } },
    select: { id: true, tenantId: true, bankAccountId: true, reconciliationId: true },
  })
  const eventById = new Map(events.map((e) => [e.id, e]))
  for (const id of m.reconciliationEventIds) {
    const e = eventById.get(id)
    if (!e) problems.push(`BankReconciliationEvent ${id}: not found`)
    else if (e.tenantId !== tenantId) problems.push(`BankReconciliationEvent ${id}: belongs to a different tenant`)
    else if (e.reconciliationId ? !reconSet.has(e.reconciliationId) : !accountSet.has(e.bankAccountId)) {
      problems.push(`BankReconciliationEvent ${id}: audit row of a reconciliation or bank account that is kept`)
    }
  }

  // Statement lines.
  const lines = await db.bankStatementLine.findMany({
    where: { id: { in: m.statementLineIds } },
    select: { id: true, tenantId: true, bankAccountId: true, description: true, reconciled: true, lockedAt: true, journalEntryId: true },
  })
  const lineById = new Map(lines.map((l) => [l.id, l]))
  for (const id of m.statementLineIds) {
    const l = lineById.get(id)
    if (!l) problems.push(`BankStatementLine ${id}: not found`)
    else if (l.tenantId !== tenantId) problems.push(`BankStatementLine ${id}: belongs to a different tenant`)
    else if (!l.description.trim().toUpperCase().startsWith(PREFIX)) {
      problems.push(`BankStatementLine ${id}: description lacks ${PREFIX} prefix`)
    } else if (l.reconciled && !accountSet.has(l.bankAccountId)) {
      // reconcileStatementLine added the amount to BankAccount.currentBalance; deleting only the
      // line would leave that balance wrong on an account that is kept.
      problems.push(`BankStatementLine ${id}: reconciled, and its bank account is not in the manifest`)
    } else if (l.lockedAt && !accountSet.has(l.bankAccountId)) {
      problems.push(`BankStatementLine ${id}: locked by a signed-off period of a bank account that is kept`)
    } else if (l.journalEntryId && !jeSet.has(l.journalEntryId)) {
      warnings.push(`BankStatementLine ${id}: references JournalEntry ${l.journalEntryId}, which is kept`)
    }
  }
  const linesOnOtherAccounts = lines.filter((l) => l.tenantId === tenantId && !accountSet.has(l.bankAccountId))
  if (linesOnOtherAccounts.length) {
    const kept = await db.bankAccount.findMany({
      where: { id: { in: [...new Set(linesOnOtherAccounts.map((l) => l.bankAccountId))] } },
      select: { id: true, tenantId: true },
    })
    for (const a of kept) {
      if (a.tenantId !== tenantId) problems.push(`BankAccount ${a.id}: parent of a listed line but in a different tenant`)
    }
  }

  // Journal entries (lines cascade, but are deleted explicitly first so the count is checked).
  const entries = await db.journalEntry.findMany({
    where: { id: { in: allJeIds } },
    select: {
      id: true,
      tenantId: true,
      description: true,
      postedAt: true,
      isPosted: true,
      lines: { select: { accountId: true, account: { select: { tenantId: true } } } },
    },
  })
  const entryById = new Map(entries.map((e) => [e.id, e]))
  let journalLineCount = 0
  for (const id of allJeIds) {
    const e = entryById.get(id)
    if (!e) {
      problems.push(`JournalEntry ${id}: not found`)
      continue
    }
    if (e.tenantId !== tenantId) {
      problems.push(`JournalEntry ${id}: belongs to a different tenant`)
      continue
    }
    if (!e.description.trim().toUpperCase().startsWith(PREFIX)) {
      problems.push(`JournalEntry ${id}: description lacks ${PREFIX} prefix (auto-posted payment entries are never deleted)`)
    }
    if (e.lines.some((l) => l.account.tenantId !== tenantId)) {
      problems.push(`JournalEntry ${id}: has lines on another tenant's chart account`)
    }
    journalLineCount += e.lines.length
  }
  // A posted entry inside a signed-off period of a kept bank account is part of a signed book balance.
  const postedOnGl = entries.filter((e) => e.tenantId === tenantId && e.isPosted)
  const glIds = [...new Set(postedOnGl.flatMap((e) => e.lines.map((l) => l.accountId)))]
  if (glIds.length) {
    const keptBanks = await db.bankAccount.findMany({
      where: { tenantId, chartAccountId: { in: glIds }, id: { notIn: m.bankAccountIds } },
      select: { id: true, chartAccountId: true },
    })
    for (const bank of keptBanks) {
      const signed = await db.bankReconciliation.findFirst({
        where: { tenantId, bankAccountId: bank.id, status: 'SIGNED_OFF' },
        orderBy: { periodEnd: 'desc' },
        select: { periodEnd: true },
      })
      if (!signed) continue
      const boundary = signed.periodEnd.getTime() + DAY_MS
      for (const e of postedOnGl) {
        if (e.postedAt.getTime() < boundary && e.lines.some((l) => l.accountId === bank.chartAccountId)) {
          problems.push(`JournalEntry ${e.id}: inside a signed-off reconciliation period of kept BankAccount ${bank.id}`)
        }
      }
    }
  }
  if (allJeIds.length) {
    const expenseRefs = await db.expenseReport.findMany({
      where: { journalEntryId: { in: allJeIds } },
      select: { id: true, journalEntryId: true },
      take: 20,
    })
    for (const r of expenseRefs) problems.push(`JournalEntry ${r.journalEntryId}: referenced by ExpenseReport ${r.id}`)
    const lineRefs = await db.bankStatementLine.findMany({
      where: { journalEntryId: { in: allJeIds }, id: { notIn: m.statementLineIds } },
      select: { id: true, journalEntryId: true },
      take: 20,
    })
    for (const r of lineRefs) problems.push(`JournalEntry ${r.journalEntryId}: referenced by unlisted BankStatementLine ${r.id}`)
  }

  // Chart accounts are never deleted; just confirm they are this tenant's.
  if (m.chartAccountIds.length) {
    const charts = await db.chartAccount.findMany({ where: { id: { in: m.chartAccountIds } }, select: { id: true, tenantId: true } })
    const chartById = new Map(charts.map((c) => [c.id, c]))
    for (const id of m.chartAccountIds) {
      const c = chartById.get(id)
      if (!c) warnings.push(`ChartAccount ${id}: not found (report-only)`)
      else if (c.tenantId !== tenantId) problems.push(`ChartAccount ${id}: belongs to a different tenant`)
    }
  }

  return {
    problems,
    warnings,
    bankAccountIds: m.bankAccountIds,
    reconciliationIds: m.reconciliationIds,
    matchIds: m.matchIds,
    matchItemIds: items.map((i) => i.id),
    statementImportIds: m.statementImportIds,
    reconciliationEventIds: m.reconciliationEventIds,
    statementLineIds: m.statementLineIds,
    journalEntryIds: allJeIds,
    journalLineCount,
  }
}

/** Tenant-wide counts, used to prove nothing outside the manifest changed. */
async function tenantCounts(db: LedgerTx, tenantId: string): Promise<Counts> {
  const [items, matches, events, lines, imports, recons, accounts, jlines, entries] = await Promise.all([
    db.bankReconciliationMatchItem.count({ where: { tenantId } }),
    db.bankReconciliationMatch.count({ where: { tenantId } }),
    db.bankReconciliationEvent.count({ where: { tenantId } }),
    db.bankStatementLine.count({ where: { tenantId } }),
    db.bankStatementImport.count({ where: { tenantId } }),
    db.bankReconciliation.count({ where: { tenantId } }),
    db.bankAccount.count({ where: { tenantId } }),
    db.journalLine.count({ where: { entry: { tenantId } } }),
    db.journalEntry.count({ where: { tenantId } }),
  ])
  return {
    BankReconciliationMatchItem: items,
    BankReconciliationMatch: matches,
    BankReconciliationEvent: events,
    BankStatementLine: lines,
    BankStatementImport: imports,
    BankReconciliation: recons,
    BankAccount: accounts,
    JournalLine: jlines,
    JournalEntry: entries,
  }
}

/** Manifest rows still present (tenant-scoped). All zero after a successful cleanup. */
async function remainingCounts(db: LedgerTx, plan: Plan, tenantId: string): Promise<Counts> {
  const [items, matches, events, lines, imports, recons, accounts, jlines, entries] = await Promise.all([
    db.bankReconciliationMatchItem.count({ where: { tenantId, id: { in: plan.matchItemIds } } }),
    db.bankReconciliationMatch.count({ where: { tenantId, id: { in: plan.matchIds } } }),
    db.bankReconciliationEvent.count({ where: { tenantId, id: { in: plan.reconciliationEventIds } } }),
    db.bankStatementLine.count({ where: { tenantId, id: { in: plan.statementLineIds } } }),
    db.bankStatementImport.count({ where: { tenantId, id: { in: plan.statementImportIds } } }),
    db.bankReconciliation.count({ where: { tenantId, id: { in: plan.reconciliationIds } } }),
    db.bankAccount.count({ where: { tenantId, id: { in: plan.bankAccountIds } } }),
    db.journalLine.count({ where: { entryId: { in: plan.journalEntryIds }, entry: { tenantId } } }),
    db.journalEntry.count({ where: { tenantId, id: { in: plan.journalEntryIds } } }),
  ])
  return {
    BankReconciliationMatchItem: items,
    BankReconciliationMatch: matches,
    BankReconciliationEvent: events,
    BankStatementLine: lines,
    BankStatementImport: imports,
    BankReconciliation: recons,
    BankAccount: accounts,
    JournalLine: jlines,
    JournalEntry: entries,
  }
}

function expectedDeletes(plan: Plan): Counts {
  return {
    BankReconciliationMatchItem: plan.matchItemIds.length,
    BankReconciliationMatch: plan.matchIds.length,
    BankReconciliationEvent: plan.reconciliationEventIds.length,
    BankStatementLine: plan.statementLineIds.length,
    BankStatementImport: plan.statementImportIds.length,
    BankReconciliation: plan.reconciliationIds.length,
    BankAccount: plan.bankAccountIds.length,
    JournalLine: plan.journalLineCount,
    JournalEntry: plan.journalEntryIds.length,
  }
}

function assertScopedIds(table: string, tenantId: string, ids: string[]) {
  if (!tenantId || !ids.length || ids.some((id) => !RECORD_ID_RE.test(id))) {
    throw new Error(`Refusing unscoped delete on ${table}`)
  }
}

/** Deletes children before parents (TABLES order). Every deleteMany is filtered by tenant AND exact ids. */
async function deletePlan(tx: LedgerTx, plan: Plan, tenantId: string): Promise<Counts> {
  const deleted: Counts = { ...ZERO_COUNTS }
  if (plan.matchItemIds.length) {
    assertScopedIds('BankReconciliationMatchItem', tenantId, plan.matchItemIds)
    deleted.BankReconciliationMatchItem = (
      await tx.bankReconciliationMatchItem.deleteMany({ where: { tenantId, id: { in: plan.matchItemIds } } })
    ).count
  }
  if (plan.matchIds.length) {
    assertScopedIds('BankReconciliationMatch', tenantId, plan.matchIds)
    deleted.BankReconciliationMatch = (await tx.bankReconciliationMatch.deleteMany({ where: { tenantId, id: { in: plan.matchIds } } })).count
  }
  if (plan.reconciliationEventIds.length) {
    assertScopedIds('BankReconciliationEvent', tenantId, plan.reconciliationEventIds)
    deleted.BankReconciliationEvent = (
      await tx.bankReconciliationEvent.deleteMany({ where: { tenantId, id: { in: plan.reconciliationEventIds } } })
    ).count
  }
  if (plan.statementLineIds.length) {
    assertScopedIds('BankStatementLine', tenantId, plan.statementLineIds)
    deleted.BankStatementLine = (
      await tx.bankStatementLine.deleteMany({ where: { tenantId, id: { in: plan.statementLineIds } } })
    ).count
  }
  if (plan.statementImportIds.length) {
    assertScopedIds('BankStatementImport', tenantId, plan.statementImportIds)
    deleted.BankStatementImport = (
      await tx.bankStatementImport.deleteMany({ where: { tenantId, id: { in: plan.statementImportIds } } })
    ).count
  }
  if (plan.reconciliationIds.length) {
    assertScopedIds('BankReconciliation', tenantId, plan.reconciliationIds)
    deleted.BankReconciliation = (await tx.bankReconciliation.deleteMany({ where: { tenantId, id: { in: plan.reconciliationIds } } })).count
  }
  if (plan.bankAccountIds.length) {
    assertScopedIds('BankAccount', tenantId, plan.bankAccountIds)
    deleted.BankAccount = (await tx.bankAccount.deleteMany({ where: { tenantId, id: { in: plan.bankAccountIds } } })).count
  }
  if (plan.journalEntryIds.length) {
    assertScopedIds('JournalLine', tenantId, plan.journalEntryIds)
    deleted.JournalLine = (
      await tx.journalLine.deleteMany({ where: { entryId: { in: plan.journalEntryIds }, entry: { tenantId } } })
    ).count
    assertScopedIds('JournalEntry', tenantId, plan.journalEntryIds)
    deleted.JournalEntry = (await tx.journalEntry.deleteMany({ where: { tenantId, id: { in: plan.journalEntryIds } } })).count
  }
  return deleted
}

function printCounts(title: string, rows: Record<string, Partial<Counts>>) {
  console.log(`\n${title}`)
  console.table(Object.fromEntries(TABLES.map((t) => [t, Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v[t] ?? '-']))])))
}

function diffCounts(a: Counts, b: Counts): string[] {
  return (Object.keys(a) as (keyof Counts)[]).filter((k) => a[k] !== b[k]).map((k) => `${k}: expected ${a[k]}, got ${b[k]}`)
}

function printReportOnly(m: Manifest) {
  const outOfScope = [
    ['ChartAccount (never deleted)', m.chartAccountIds],
    ['Payment ids (order/purchasing databases, not touched)', m.paymentIds],
    ['Other records (not touched)', m.otherRecordIds],
  ] as const
  if (outOfScope.every(([, ids]) => ids.length === 0)) return
  console.log('\nNOT REMOVED by this script (manual follow-up, see review doc):')
  for (const [label, ids] of outOfScope) if (ids.length) console.log(`  ${label}: ${ids.join(', ')}`)
}

async function verifyTenant(tenant: TenantClient, tenantId: string) {
  const org = await tenant.tenantOrganization.findUnique({ where: { id: tenantId }, select: { slug: true, displayName: true } })
  if (!org) throw new RefusedError('Tenant id not found in the tenant database')
  if (!/banktest/i.test(org.slug) && !/banktest/i.test(org.displayName)) {
    throw new RefusedError('Tenant is not a BANKTEST tenant (slug/display name lacks BANKTEST)')
  }
}

async function run(args: Args): Promise<number> {
  const tenantId = validateTenantId(args.tenantId!)
  const testRunId = validateTestRunId(args.testRunId!)
  const manifestPath = path.resolve(args.manifest!)
  if (!fs.existsSync(manifestPath)) throw new UsageError('Manifest file not found')
  const manifestBytes = fs.readFileSync(manifestPath)
  const manifestSha = sha256(manifestBytes)
  let raw: unknown
  try {
    raw = JSON.parse(manifestBytes.toString('utf8'))
  } catch {
    throw new RefusedError('Manifest is not valid JSON')
  }
  const manifest = validateManifest(raw, tenantId, testRunId)

  console.log(`BANKTEST cleanup — test run ${testRunId}, tenant ${tenantId}`)
  console.log(`Manifest sha256: ${manifestSha}`)
  console.log(
    `Manifest ids: ${DELETABLE_LISTS.map((k) => `${k}=${manifest[k].length}`).join(', ')}; ` +
      `report-only: ${REPORT_ONLY_LISTS.map((k) => `${k}=${manifest[k].length}`).join(', ')}`,
  )

  if (args.checkManifest) {
    console.log('\nManifest is well formed. No database was contacted (--check-manifest).')
    printReportOnly(manifest)
    return EXIT_OK
  }

  // Captured before any Prisma client loads, so .env files picked up by Prisma cannot redirect us.
  const ledgerUrl = readDatabaseUrl('LEDGER_DATABASE_URL')
  const tenantUrl = readDatabaseUrl('TENANT_DATABASE_URL')
  assertNotProduction({ LEDGER_DATABASE_URL: ledgerUrl, TENANT_DATABASE_URL: tenantUrl })
  const ledgerFp = databaseFingerprint(ledgerUrl)
  console.log(`Ledger database: ${ledgerFp.kind}, fingerprint ${ledgerFp.fingerprint}`)

  if (args.execute) {
    if (args.confirmStaging !== `DELETE-STAGING-${testRunId}`) {
      throw new RefusedError(`--confirm-staging must be exactly DELETE-STAGING-${testRunId}`)
    }
    if (args.expectDbFingerprint?.toLowerCase() !== ledgerFp.fingerprint) {
      throw new RefusedError('--expect-db-fingerprint does not match LEDGER_DATABASE_URL')
    }
    if (args.approvedManifestSha256?.toLowerCase() !== manifestSha) {
      throw new RefusedError('--approved-manifest-sha256 does not match the manifest file')
    }
  }

  const { PrismaClient: LedgerPrisma, Prisma } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../apps/web/generated/prisma-ledger') as typeof import('../apps/web/generated/prisma-ledger')
  const { PrismaClient: TenantPrisma } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../apps/web/generated/prisma-tenant') as typeof import('../apps/web/generated/prisma-tenant')
  const ledger = new LedgerPrisma({ datasources: { db: { url: ledgerUrl } }, log: [] })
  const tenant = new TenantPrisma({ datasources: { db: { url: tenantUrl } }, log: [] })

  try {
    await verifyTenant(tenant, tenantId)
    console.log('Tenant check: OK (BANKTEST tenant)')

    const plan = await buildPlan(ledger, manifest)
    const before = await tenantCounts(ledger, tenantId)
    const expected = expectedDeletes(plan)
    printCounts('Candidate rows (manifest ids, this tenant) vs tenant totals', {
      'to delete': expected,
      'tenant total before': before,
    })
    for (const w of plan.warnings) console.log(`WARNING  ${w}`)
    printReportOnly(manifest)

    if (plan.problems.length) {
      console.log('\nCANNOT SAFELY DELETE — fix the manifest or the data; criteria are never broadened:')
      for (const p of plan.problems) console.log(`  - ${p}`)
      console.log(args.execute ? '\nNothing was deleted.' : '\nDry-run only; nothing was changed.')
      return EXIT_REFUSED
    }

    if (!args.execute) {
      console.log('\nDry-run complete; nothing was changed. To execute after review:')
      console.log(
        `  npx tsx ${SCRIPT} --manifest <file> --tenant-id ${tenantId} --test-run-id ${testRunId} --execute \\\n` +
          `    --confirm-staging DELETE-STAGING-${testRunId} --expect-db-fingerprint ${ledgerFp.fingerprint} \\\n` +
          `    --approved-manifest-sha256 ${manifestSha}`,
      )
      return EXIT_OK
    }

    // One transaction: re-validate, delete, verify. Any throw rolls everything back.
    const result = await ledger.$transaction(
      async (tx) => {
        const txPlan = await buildPlan(tx, manifest)
        if (txPlan.problems.length) throw new RefusedError(`Data changed since dry-run: ${txPlan.problems[0]}`)
        const txBefore = await tenantCounts(tx, tenantId)
        const deleted = await deletePlan(tx, txPlan, tenantId)
        const mismatch = diffCounts(expectedDeletes(txPlan), deleted)
        if (mismatch.length) throw new Error(`Deleted counts differ from plan: ${mismatch.join('; ')}`)
        const remaining = await remainingCounts(tx, txPlan, tenantId)
        const leftover = diffCounts(ZERO_COUNTS, remaining)
        if (leftover.length) throw new Error(`Manifest rows remain after delete: ${leftover.join('; ')}`)
        const after = await tenantCounts(tx, tenantId)
        const expectAfter = Object.fromEntries(
          (Object.keys(txBefore) as (keyof Counts)[]).map((k) => [k, txBefore[k] - deleted[k]]),
        ) as Counts
        const drift = diffCounts(expectAfter, after)
        if (drift.length) throw new Error(`Rows outside the manifest changed: ${drift.join('; ')}`)
        return { txPlan, txBefore, deleted, after }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000, maxWait: 10_000 },
    )

    // Independent check after commit, on a fresh read.
    const postRemaining = await remainingCounts(ledger, result.txPlan, tenantId)
    const postAfter = await tenantCounts(ledger, tenantId)
    printCounts('Result', {
      'tenant before': result.txBefore,
      deleted: result.deleted,
      'tenant after': postAfter,
      'manifest rows remaining': postRemaining,
    })
    const problems = [...diffCounts(ZERO_COUNTS, postRemaining), ...diffCounts(result.after, postAfter)]
    if (problems.length) {
      console.error(`\nPOST-COMMIT VERIFICATION FAILED: ${problems.join('; ')}`)
      return EXIT_FAILED
    }
    console.log(`\nCleanup committed and verified: no ledger records for ${testRunId} remain.`)
    return EXIT_OK
  } finally {
    await ledger.$disconnect()
    await tenant.$disconnect()
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
      console.error(`REFUSED: ${e.message}. Nothing was deleted.`)
      return EXIT_REFUSED
    }
    // Prisma errors can echo connection details; print only their class and code.
    const err = e as { name?: string; code?: string; message?: string }
    const detail = err.name?.startsWith('PrismaClient')
      ? `${err.name}${err.code ? ` (${err.code})` : ''}`
      : (err.message ?? 'Error')
    console.error(`FAILED: ${detail}. Any open transaction was rolled back.`)
    return EXIT_FAILED
  }
}

main().then((code) => process.exit(code))
