// Must stay the first import: points every database at fresh temp files before ./db loads.
import { ISOLATED_SKIP, assertIsolated, disposeIsolatedDatabases, prepareIsolatedDatabases } from './test-support/isolated-databases'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-ledger'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { RECON_RULES, planAutoMatches } from './bank-reconciliation'
import { reconciliationReportLines } from './bank-reconciliation-document'
import { createBankAccount, getReconciliationSummary } from './bank-recon'
import { authDb, ledgerDb, tenantDb } from './db'
import { invalidateUserSessionCache } from './session'

/** Tests that need the isolated databases; skipped with the reason where they cannot exist (CI on Postgres). */
const dbTest = (name: string, fn: () => void | Promise<void>) => test(name, { skip: ISOLATED_SKIP }, fn)

// ---------------------------------------------------------------------------------------------
// Fixtures

const PASSWORD = 'bank-recon-test-pass-1'
const DAY = 86_400_000

/** A fully past month (three months back), so sign-off is allowed. */
const now = new Date()
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))
const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 0))
const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (n: number) => iso(new Date(monthStart.getTime() + (n - 1) * DAY))
const P_START = iso(monthStart)
const P_END = iso(monthEnd)

type Tenant = {
  id: string
  tokens: Record<string, string>
  userIds: Record<string, string>
  accounts: Record<'cash' | 'ar' | 'ap' | 'equity' | 'fees', string>
}

async function makeUser(tenantId: string, role: string, permissions: string[] = [], label = role) {
  const email = `${label.toLowerCase().replace(/[^a-z]/g, '')}-${randomUUID().slice(0, 8)}@example.test`
  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      firstName: label,
      lastName: 'Tester',
      role: role as never,
      permissions,
      emailVerifiedAt: new Date(),
    },
  })
  return { id: user.id, token: (await loginUser(email, PASSWORD)).accessToken }
}

async function makeTenant(slug: string): Promise<Tenant> {
  const id = `t-${randomUUID()}`
  await authDb.tenant.create({ data: { id, name: slug, slug: `${slug}-${id.slice(-6)}`, settings: {} } })
  await tenantDb.tenantOrganization.create({ data: { id, slug: `${slug}-${id.slice(-6)}`, displayName: slug, settings: {}, metadata: {} } })
  const tokens: Record<string, string> = {}
  const userIds: Record<string, string> = {}
  const users: [string, string, string[]][] = [
    ['ACCOUNTANT', 'ACCOUNTANT', []],
    ['MANAGER', 'MANAGER', []],
    ['TENANT_ADMIN', 'TENANT_ADMIN', []],
    ['SALES_REP', 'SALES_REP', []],
    ['VIEWER', 'VIEWER', []],
    ['WAREHOUSE_STAFF', 'WAREHOUSE_STAFF', []],
    ['STAFF', 'STAFF', []],
    ['PREPARER_ONLY', 'ACCOUNTANT', ['finance.read', 'finance.reconcile']],
    ['REOPENER', 'ACCOUNTANT', ['finance.read', 'finance.reconcile.reopen']],
  ]
  for (const [label, role, perms] of users) {
    const u = await makeUser(id, role, perms, label)
    tokens[label] = u.token
    userIds[label] = u.id
  }
  const chart = async (code: string, name: string, type: string) =>
    (await ledgerDb.chartAccount.create({ data: { tenantId: id, code, name, type: type as never } })).id
  return {
    id,
    tokens,
    userIds,
    accounts: {
      cash: await chart('1000', 'Cash - Operating', 'ASSET'),
      ar: await chart('1200', 'Accounts receivable', 'ASSET'),
      ap: await chart('2100', 'Accounts payable', 'LIABILITY'),
      equity: await chart('3000', 'Owner equity', 'EQUITY'),
      fees: await chart('6100', 'Bank fees', 'EXPENSE'),
    },
  }
}

/** A posted two-line entry, as the payment GL helpers write them. Returns the cash line id. */
async function postCash(t: Tenant, date: string, amount: number, other: string, description: string) {
  const cashDebit = amount > 0
  const abs = new Prisma.Decimal(Math.abs(amount))
  const entry = await ledgerDb.journalEntry.create({
    data: {
      tenantId: t.id,
      description,
      isPosted: true,
      postedAt: new Date(`${date}T12:00:00Z`),
      lines: {
        create: [
          { accountId: t.accounts.cash, debit: cashDebit ? abs : 0, credit: cashDebit ? 0 : abs },
          { accountId: other, debit: cashDebit ? 0 : abs, credit: cashDebit ? abs : 0 },
        ],
      },
    },
    include: { lines: true },
  })
  return entry.lines.find((l) => l.accountId === t.accounts.cash)!.id
}

type ApiResult = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any

async function api(token: string, method: string, path: string, body?: unknown): Promise<ApiResult> {
  const res = await handleApiRequest(
    new Request(`http://localhost/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  const type = res.headers.get('content-type') ?? ''
  return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) }
}

/** Everything a rejected request could have changed for a tenant, as a comparable fingerprint. */
async function ledgerState(tenantId: string) {
  const [recons, matches, items, lines, imports, events, entries] = await Promise.all([
    ledgerDb.bankReconciliation.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    ledgerDb.bankReconciliationMatch.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    ledgerDb.bankReconciliationMatchItem.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    ledgerDb.bankStatementLine.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    ledgerDb.bankStatementImport.count({ where: { tenantId } }),
    ledgerDb.bankReconciliationEvent.count({ where: { tenantId } }),
    ledgerDb.journalEntry.findMany({ where: { tenantId }, select: { id: true, isPosted: true }, orderBy: { id: 'asc' } }),
  ])
  return JSON.stringify({ recons, matches, items, lines, imports, events, entries })
}

async function assertNoChange(tenantId: string, fn: () => Promise<void>) {
  const before = await ledgerState(tenantId)
  await fn()
  assert.equal(await ledgerState(tenantId), before, 'a rejected action changed ledger state')
}

const STATEMENT_CSV = [
  'date,description,amount,reference',
  `${day(3)},BANKTEST deposit INV-A,250.00,R1`,
  `${day(10)},BANKTEST vendor pmt BILL-B,-120.00,R2`,
  `${day(15)},BANKTEST deposit dup-amt 1,75.00,R3`,
  `${day(16)},BANKTEST deposit dup-amt 2,75.00,R4`,
  `${day(20)},BANKTEST batched deposit,300.00,R6`,
  `${day(22)},BANKTEST split deposit part 1,40.00,R7`,
  `${day(22)},BANKTEST split deposit part 2,60.00,R8`,
  `${day(28)},BANKTEST bank fee,-15.00,R5`,
].join('\n')

let A: Tenant
let B: Tenant
let bankA = ''
let reconA = ''
let reconB = ''
const book: Record<string, string> = {}
const lineByRef: Record<string, string> = {}
let lateDraftId = ''

before(async () => {
  if (ISOLATED_SKIP) return
  assertIsolated()
  await prepareIsolatedDatabases(['auth', 'tenant', 'ledger'])
  A = await makeTenant('banktest-a')
  B = await makeTenant('banktest-b')
})

after(async () => {
  if (ISOLATED_SKIP) return disposeIsolatedDatabases()
  RECON_RULES.requireDistinctSigner = false
  invalidateUserSessionCache()
  await disposeIsolatedDatabases()
})

// ---------------------------------------------------------------------------------------------
// Pure algorithm

test('auto-match plan: exact pair matches, window excludes, equal amounts stay ambiguous', () => {
  const at = (s: string) => new Date(`${s}T00:00:00Z`)
  const d = (n: string) => new Prisma.Decimal(n)
  const plan = planAutoMatches(
    [
      { id: 'b1', date: at('2026-09-03'), amount: d('250') },
      { id: 'b2', date: at('2026-09-10'), amount: d('-120') },
      { id: 'b3', date: at('2026-09-15'), amount: d('75') },
      { id: 'b4', date: at('2026-09-16'), amount: d('75') },
      { id: 'b5', date: at('2026-09-20'), amount: d('-250') },
    ],
    [
      { id: 'k1', date: at('2026-09-02'), amount: d('250.00') },
      { id: 'k2', date: at('2026-09-01'), amount: d('-120') },
      { id: 'k3', date: at('2026-09-15'), amount: d('75') },
      { id: 'k4', date: at('2026-09-15'), amount: d('75') },
    ],
    3,
  )
  assert.deepEqual(plan.pairs, [{ statementLineId: 'b1', journalLineId: 'k1' }])
  assert.deepEqual(plan.ambiguousStatementLineIds.sort(), ['b3', 'b4'])
  assert.deepEqual(plan.ambiguousJournalLineIds.sort(), ['k3', 'k4'])
  // Sign matters: -250 never pairs with +250.
  assert.ok(!plan.pairs.some((p) => p.statementLineId === 'b5'))
  // One bank line, two equal book candidates: still ambiguous.
  const oneToTwo = planAutoMatches([{ id: 'b', date: at('2026-09-15'), amount: d('75') }], [
    { id: 'k', date: at('2026-09-15'), amount: d('75') },
    { id: 'j', date: at('2026-09-14'), amount: d('75') },
  ], 3)
  assert.equal(oneToTwo.pairs.length, 0)
})

// ---------------------------------------------------------------------------------------------
// Setup through the API

dbTest('setup: bank account linked to its GL cash account, reconciliation created', async () => {
  const acct = A.tokens.ACCOUNTANT!
  // Opening balance booked before the reconciliation start date (already cleared).
  await postCash(A, iso(new Date(monthStart.getTime() - DAY)), 1000, A.accounts.equity, 'Opening balance')
  book.invA = await postCash(A, day(2), 250, A.accounts.ar, 'AR payment INV-A')
  book.billB = await postCash(A, day(1), -120, A.accounts.ap, 'AP payment BILL-B')
  book.c1 = await postCash(A, day(15), 75, A.accounts.ar, 'AR payment C1')
  book.c2 = await postCash(A, day(15), 75, A.accounts.ar, 'AR payment C2')
  book.d1 = await postCash(A, day(19), 100, A.accounts.ar, 'AR payment D1')
  book.d2 = await postCash(A, day(19), 200, A.accounts.ar, 'AR payment D2')
  book.e = await postCash(A, day(21), 100, A.accounts.ar, 'AR payment E')

  // GL link must be an asset account of this tenant.
  assert.equal((await api(acct, 'POST', '/bank-accounts', { name: 'BANKTEST bad', chartAccountId: A.accounts.fees })).status, 400)
  assert.equal((await api(acct, 'POST', '/bank-accounts', { name: 'BANKTEST bad', chartAccountId: B.accounts.cash })).status, 400)
  assert.equal((await api(acct, 'POST', '/bank-accounts', { name: 'BANKTEST bad', openingBalance: 'abc' })).status, 400)
  const created = await api(acct, 'POST', '/bank-accounts', {
    name: 'BANKTEST Operating',
    accountNumber: '000123456789',
    openingBalance: 1000,
    chartAccountId: A.accounts.cash,
    openingBalanceDate: P_START,
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  bankA = created.body.id
  // A second bank account may not share the GL account (book side would mix).
  assert.equal((await api(acct, 'POST', '/bank-accounts', { name: 'BANKTEST dup GL', chartAccountId: A.accounts.cash })).status, 409)

  // Bank account without a GL link cannot be reconciled.
  const unlinked = await api(acct, 'POST', '/bank-accounts', { name: 'BANKTEST unlinked' })
  const noGl = await api(acct, 'POST', '/bank-reconciliations', {
    bankAccountId: unlinked.body.id,
    periodStart: P_START,
    periodEnd: P_END,
    statementOpeningBalance: '1000.00',
    statementClosingBalance: '1665.00',
  })
  assert.equal(noGl.status, 409)

  const recon = await api(acct, 'POST', '/bank-reconciliations', {
    bankAccountId: bankA,
    periodStart: P_START,
    periodEnd: P_END,
    statementOpeningBalance: '1000.00',
    statementClosingBalance: '1667.50',
    dateWindowDays: 3,
  })
  assert.equal(recon.status, 201, JSON.stringify(recon.body))
  assert.equal(recon.body.status, 'UNRECONCILED')
  assert.equal(recon.body.createdById, A.userIds.ACCOUNTANT)
  reconA = recon.body.id

  // Overlapping period for the same account is refused.
  const overlap = await api(acct, 'POST', '/bank-reconciliations', {
    bankAccountId: bankA,
    periodStart: day(10),
    periodEnd: day(20),
    statementOpeningBalance: 0,
    statementClosingBalance: 0,
  })
  assert.equal(overlap.status, 409)

  // Tenant B gets its own account and period, used by the isolation tests.
  const bankB = await api(B.tokens.ACCOUNTANT!, 'POST', '/bank-accounts', { name: 'B Operating', chartAccountId: B.accounts.cash, openingBalanceDate: P_START })
  const rb = await api(B.tokens.ACCOUNTANT!, 'POST', '/bank-reconciliations', {
    bankAccountId: bankB.body.id,
    periodStart: P_START,
    periodEnd: P_END,
    statementOpeningBalance: 0,
    statementClosingBalance: 0,
  })
  assert.equal(rb.status, 201)
  reconB = rb.body.id
})

// ---------------------------------------------------------------------------------------------
// CSV import

dbTest('malformed CSV rows are rejected with row numbers and nothing is imported', async () => {
  const csv = [
    'date,description,amount,reference',
    `${day(3)},BANKTEST ok,10.00,X1`,
    `2026-02-30,BANKTEST bad date,10.00,X2`,
    `${day(4)},BANKTEST bad amount,ten,X3`,
    `${day(5)},,10.00,X4`,
    `${iso(new Date(monthEnd.getTime() + 2 * DAY))},BANKTEST after period,10.00,X5`,
  ].join('\n')
  await assertNoChange(A.id, async () => {
    const res = await api(A.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${reconA}/import-csv`, { csvText: csv })
    assert.equal(res.status, 400)
    assert.deepEqual(
      res.body.errors.map((e: { row: number }) => e.row),
      [3, 4, 5, 6],
    )
  })
  // Legacy JSON import (defect D4): invalid rows used to crash with 500 or store NaN.
  await assertNoChange(A.id, async () => {
    const res = await api(A.tokens.ACCOUNTANT!, 'POST', `/bank-accounts/${bankA}/import`, {
      lines: [{ postedAt: 'bad', description: 'x', amount: 'abc' }, { postedAt: day(2) }],
    })
    assert.equal(res.status, 400)
    assert.equal(res.body.errors.length, 2)
  })
})

dbTest('CSV import, then the same file again (rejected) and an overlapping file (duplicates skipped)', async () => {
  const acct = A.tokens.ACCOUNTANT!
  const first = await api(acct, 'POST', `/bank-reconciliations/${reconA}/import-csv`, { csvText: STATEMENT_CSV, fileName: 'sept.csv' })
  assert.equal(first.status, 201, JSON.stringify(first.body))
  assert.equal(first.body.imported, 8)
  assert.equal(first.body.skippedDuplicates, 0)

  await assertNoChange(A.id, async () => {
    const again = await api(acct, 'POST', `/bank-reconciliations/${reconA}/import-csv`, { csvText: STATEMENT_CSV.replace(/\n/g, '\r\n') })
    assert.equal(again.status, 409)
    assert.match(again.body.message, /already imported/)
  })

  const overlapping = `${STATEMENT_CSV}\n${day(29)},BANKTEST interest,2.50,R9`
  const second = await api(acct, 'POST', `/bank-reconciliations/${reconA}/import-csv`, { csvText: overlapping })
  assert.equal(second.status, 201)
  assert.equal(second.body.imported, 1)
  assert.equal(second.body.skippedDuplicates, 8)

  // Legacy JSON import of rows that already exist adds nothing.
  const legacy = await api(acct, 'POST', `/bank-accounts/${bankA}/import`, {
    lines: [{ postedAt: day(3), description: 'BANKTEST deposit INV-A', amount: 250, reference: 'R1' }],
  })
  assert.equal(legacy.status, 201)
  assert.equal(legacy.body.length, 0)

  const lines = await ledgerDb.bankStatementLine.findMany({ where: { tenantId: A.id, bankAccountId: bankA } })
  assert.equal(lines.length, 9)
  for (const l of lines) lineByRef[l.reference!] = l.id
  const events = await ledgerDb.bankReconciliationEvent.findMany({ where: { tenantId: A.id, reconciliationId: reconA } })
  assert.ok(events.some((e) => e.action === 'bank_statement.duplicate_skipped'))

  // The interest line (R9) is booked by an adjusting entry so it can be matched later.
  book.interest = await postCash(A, day(29), 2.5, A.accounts.equity, 'BANKTEST interest income')
})

// ---------------------------------------------------------------------------------------------
// Matching

dbTest('auto-match: exact amount within window matches; outside window and equal-amount ambiguity stay open', async () => {
  // The workspace previews the suggestions without writing anything.
  let preview: { pairs: { statementLineId: string; journalLineId: string }[]; ambiguousStatementLineIds: string[] } | undefined
  await assertNoChange(A.id, async () => {
    preview = (await api(A.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconA}`)).body.autoMatchPreview
  })
  assert.deepEqual(
    preview!.pairs.map((p) => [p.statementLineId, p.journalLineId]),
    [
      [lineByRef.R1, book.invA],
      [lineByRef.R9, book.interest],
    ],
  )
  assert.deepEqual([...preview!.ambiguousStatementLineIds].sort(), [lineByRef.R3, lineByRef.R4].sort())

  const res = await api(A.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${reconA}/auto-match`, {})
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const pairs = res.body.matches.map((m: { statementLineId: string; journalLineId: string }) => [m.statementLineId, m.journalLineId])
  assert.deepEqual(pairs, [
    [lineByRef.R1, book.invA],
    [lineByRef.R9, book.interest],
  ])
  assert.deepEqual([...res.body.ambiguousStatementLineIds].sort(), [lineByRef.R3, lineByRef.R4].sort())
  assert.deepEqual([...res.body.ambiguousJournalLineIds].sort(), [book.c1, book.c2].sort())

  const ws = (await api(A.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconA}`)).body
  assert.equal(ws.reconciliation.status, 'IN_PROGRESS')
  assert.equal(ws.autoMatchPreview.pairs.length, 0, 'applied suggestions leave the preview')
  const r1Match = ws.matched.find((m: { statementLines: { statementLineId: string }[] }) => m.statementLines[0]?.statementLineId === lineByRef.R1)
  assert.equal(r1Match.type, 'AUTO')
  assert.equal(r1Match.statementLines[0].description, 'BANKTEST deposit INV-A')
  assert.equal(r1Match.statementLines[0].date, day(3))
  assert.ok(r1Match.journalLines[0].description)
  const openBank = ws.unmatchedBank.map((b: { statementLineId: string }) => b.statementLineId)
  const openBook = ws.unmatchedBook.map((b: { journalLineId: string }) => b.journalLineId)
  // 9 days apart with a 3-day window: both sides stay unmatched.
  assert.ok(openBank.includes(lineByRef.R2))
  assert.ok(openBook.includes(book.billB))

  // Positive control: a 9-day window matches it.
  const wide = await api(A.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${reconA}/auto-match`, { dateWindowDays: 9 })
  assert.equal(wide.body.matched, 1)
  assert.deepEqual([wide.body.matches[0].statementLineId, wide.body.matches[0].journalLineId], [lineByRef.R2, book.billB])
  assert.equal((await api(A.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${reconA}/auto-match`, { dateWindowDays: 99 })).status, 400)
})

dbTest('manual match and unmatch keep a full trail; rematch is allowed', async () => {
  const acct = A.tokens.ACCOUNTANT!
  const path = `/bank-reconciliations/${reconA}/matches`
  await assertNoChange(A.id, async () => {
    const unequal = await api(acct, 'POST', path, { statementLineIds: [lineByRef.R3], journalLineIds: [book.d1] })
    assert.equal(unequal.status, 400)
    assert.match(unequal.body.message, /totals differ/)
    const alreadyMatched = await api(acct, 'POST', path, { statementLineIds: [lineByRef.R1], journalLineIds: [book.c1] })
    assert.equal(alreadyMatched.status, 409)
  })

  const m1 = await api(acct, 'POST', path, { statementLineIds: [lineByRef.R3], journalLineIds: [book.c1] })
  assert.equal(m1.status, 201, JSON.stringify(m1.body))
  // POST alias (what the UI sends, so the reason travels in the body); the DELETE form is equivalent.
  const undo = await api(acct, 'POST', `${path}/${m1.body.matchId}/unmatch`, { reason: 'picked the wrong deposit' })
  assert.equal(undo.status, 200)
  await assertNoChange(A.id, async () => {
    assert.equal((await api(acct, 'DELETE', `${path}/${m1.body.matchId}`, {})).status, 409)
    assert.equal((await api(acct, 'POST', `${path}/${m1.body.matchId}/unmatch`, {})).status, 409)
  })
  const kept = await ledgerDb.bankReconciliationMatch.findUnique({ where: { id: m1.body.matchId }, include: { items: true } })
  assert.ok(kept?.unmatchedAt, 'unmatched match is kept, not deleted')
  assert.equal(kept?.unmatchedById, A.userIds.ACCOUNTANT)
  assert.ok(kept?.items.every((i) => i.activeStatementLineId === null && i.activeJournalLineId === null))
  assert.ok(kept?.items.some((i) => i.statementLineId === lineByRef.R3))

  const m2 = await api(acct, 'POST', path, { statementLineIds: [lineByRef.R3], journalLineIds: [book.c1] })
  assert.equal(m2.status, 201)
  assert.notEqual(m2.body.matchId, m1.body.matchId)

  const actions = (await api(acct, 'GET', `/bank-reconciliations/${reconA}/events`)).body.map((e: { action: string }) => e.action)
  assert.ok(actions.filter((a: string) => a === 'bank_recon.matched').length >= 2)
  assert.ok(actions.includes('bank_recon.unmatched'))
  const mirrored = await tenantDb.auditEvent.findMany({ where: { tenantId: A.id, action: 'bank_recon.unmatched' } })
  assert.equal(mirrored.length, 1)
})

dbTest('one-to-many and many-to-one matches with equal totals', async () => {
  const acct = A.tokens.ACCOUNTANT!
  const path = `/bank-reconciliations/${reconA}/matches`
  const oneToMany = await api(acct, 'POST', path, { statementLineIds: [lineByRef.R6], journalLineIds: [book.d1, book.d2] })
  assert.equal(oneToMany.status, 201, JSON.stringify(oneToMany.body))
  assert.equal(oneToMany.body.total, '300.00')
  const manyToOne = await api(acct, 'POST', path, { statementLineIds: [lineByRef.R7, lineByRef.R8], journalLineIds: [book.e] })
  assert.equal(manyToOne.status, 201, JSON.stringify(manyToOne.body))
  assert.equal(manyToOne.body.total, '100.00')
  const ws = (await api(acct, 'GET', `/bank-reconciliations/${reconA}`)).body
  const group = ws.matched.find((m: { matchId: string }) => m.matchId === oneToMany.body.matchId)
  assert.equal(group.statementLines.length, 1)
  assert.equal(group.journalLines.length, 2)
})

dbTest('concurrent matching of the same line: exactly one wins, no double match', async () => {
  const path = `/bank-reconciliations/${reconA}/matches`
  const body = { statementLineIds: [lineByRef.R4], journalLineIds: [book.c2] }
  const results = await Promise.all([
    api(A.tokens.ACCOUNTANT!, 'POST', path, body),
    api(A.tokens.MANAGER!, 'POST', path, body),
    api(A.tokens.TENANT_ADMIN!, 'POST', path, body),
  ])
  const statuses = results.map((r) => r.status).sort()
  assert.deepEqual(statuses, [201, 409, 409], JSON.stringify(results.map((r) => r.body)))
  const active = await ledgerDb.bankReconciliationMatchItem.count({ where: { tenantId: A.id, activeStatementLineId: lineByRef.R4 } })
  assert.equal(active, 1)
  const matches = await ledgerDb.bankReconciliationMatchItem.count({ where: { tenantId: A.id, statementLineId: lineByRef.R4 } })
  assert.equal(matches, 1, 'losing requests left no partial rows')
})

// ---------------------------------------------------------------------------------------------
// Sign-off

dbTest('sign-off is blocked by unequal balances and by unbooked bank items; nothing changes', async () => {
  const mgr = A.tokens.MANAGER!
  let ws = (await api(mgr, 'GET', `/bank-reconciliations/${reconA}`)).body
  // Only the bank fee is open: balances tie, but the fee is not in the books yet.
  assert.deepEqual(ws.unmatchedBank.map((b: { statementLineId: string }) => b.statementLineId), [lineByRef.R5])
  assert.equal(ws.unmatchedBook.length, 0)
  assert.equal(ws.balances.bookBalance, '1682.50')
  assert.equal(ws.balances.difference, '0.00')
  assert.equal(ws.signOff.canSignOff, false)
  await assertNoChange(A.id, async () => {
    const res = await api(mgr, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version: ws.reconciliation.version })
    assert.equal(res.status, 409)
    assert.match(res.body.message, /not in the books/)
  })

  // Book the fee as an adjusting entry dated in the period, then match it.
  const draft = await api(A.tokens.ACCOUNTANT!, 'POST', '/journal-entries', {
    description: 'BANKTEST bank fee',
    postedAt: day(28),
    lines: [
      { accountId: A.accounts.fees, debit: 15, credit: 0 },
      { accountId: A.accounts.cash, debit: 0, credit: 15 },
    ],
  })
  assert.equal(draft.status, 201, JSON.stringify(draft.body))
  assert.equal((await api(A.tokens.ACCOUNTANT!, 'POST', `/journal-entries/${draft.body.id}/post`)).status, 200)
  // A draft dated inside the period, left unposted until after sign-off (used by the lock test).
  const late = await api(A.tokens.ACCOUNTANT!, 'POST', '/journal-entries', {
    description: 'BANKTEST late entry',
    postedAt: day(20),
    lines: [
      { accountId: A.accounts.cash, debit: 10, credit: 0 },
      { accountId: A.accounts.ar, debit: 0, credit: 10 },
    ],
  })
  lateDraftId = late.body.id
  const fee = await api(A.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${reconA}/auto-match`, {})
  assert.equal(fee.body.matched, 1)

  // Wrong statement closing balance: adjusted balances differ.
  assert.equal((await api(A.tokens.ACCOUNTANT!, 'PATCH', `/bank-reconciliations/${reconA}`, { statementClosingBalance: '1700.00' })).status, 200)
  ws = (await api(mgr, 'GET', `/bank-reconciliations/${reconA}`)).body
  assert.equal(ws.balances.difference, '-32.50')
  await assertNoChange(A.id, async () => {
    const res = await api(mgr, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version: ws.reconciliation.version })
    assert.equal(res.status, 409)
    assert.match(res.body.message, /differ by -32\.50/)
  })
  assert.equal((await api(A.tokens.ACCOUNTANT!, 'PATCH', `/bank-reconciliations/${reconA}`, { statementClosingBalance: '1667.50' })).status, 200)
})

dbTest('sign-off needs the dedicated permission and the current version', async () => {
  const ws = (await api(A.tokens.MANAGER!, 'GET', `/bank-reconciliations/${reconA}`)).body
  assert.equal(ws.balances.adjustedBook, '1667.50')
  assert.equal(ws.balances.adjustedBank, '1667.50')
  assert.equal(ws.signOff.canSignOff, true, JSON.stringify(ws.signOff))
  await assertNoChange(A.id, async () => {
    const noPerm = await api(A.tokens.PREPARER_ONLY!, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version: ws.reconciliation.version })
    assert.equal(noPerm.status, 403)
    const stale = await api(A.tokens.MANAGER!, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version: ws.reconciliation.version - 1 })
    assert.equal(stale.status, 409)
    assert.equal((await api(A.tokens.MANAGER!, 'POST', `/bank-reconciliations/${reconA}/sign-off`, {})).status, 400)
  })
  // Positive control for the preparer-only user: it can read and prepare.
  assert.equal((await api(A.tokens.PREPARER_ONLY!, 'GET', `/bank-reconciliations/${reconA}`)).status, 200)
})

dbTest('successful sign-off records preparer and signer; a concurrent double sign-off has one winner', async () => {
  const ws = (await api(A.tokens.MANAGER!, 'GET', `/bank-reconciliations/${reconA}`)).body
  const version = ws.reconciliation.version
  const results = await Promise.all([
    api(A.tokens.MANAGER!, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version }),
    api(A.tokens.TENANT_ADMIN!, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version }),
  ])
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)))
  const won = results.find((r) => r.status === 200)!.body
  assert.equal(won.status, 'SIGNED_OFF')
  assert.equal(won.preparedById, A.userIds.ACCOUNTANT)
  assert.ok([A.userIds.MANAGER, A.userIds.TENANT_ADMIN].includes(won.signedOffById))
  assert.ok(won.signedOffAt)
  assert.equal(won.snapshot.adjustedBook, '1667.50')
  assert.equal(won.version, version + 1)

  await assertNoChange(A.id, async () => {
    const again = await api(A.tokens.MANAGER!, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version: won.version })
    assert.equal(again.status, 409)
    assert.match(again.body.message, /already signed off/)
  })
  const locked = await ledgerDb.bankStatementLine.count({ where: { tenantId: A.id, bankAccountId: bankA, lockedAt: null } })
  assert.equal(locked, 0, 'every line in the period is locked')
  const signedEvents = await ledgerDb.bankReconciliationEvent.count({ where: { tenantId: A.id, reconciliationId: reconA, action: 'bank_recon.signed_off' } })
  assert.equal(signedEvents, 1)
})

dbTest('signed-off period rejects imports, matching, unmatching, edits and backdated ledger changes', async () => {
  const acct = A.tokens.ACCOUNTANT!
  const ws = (await api(acct, 'GET', `/bank-reconciliations/${reconA}`)).body
  const someMatch = ws.matched[0].matchId
  await assertNoChange(A.id, async () => {
    const tries: [string, string, unknown][] = [
      ['POST', `/bank-reconciliations/${reconA}/import-csv`, { csvText: `date,description,amount\n${day(12)},BANKTEST late line,5.00` }],
      ['POST', `/bank-reconciliations/${reconA}/auto-match`, {}],
      ['POST', `/bank-reconciliations/${reconA}/matches`, { statementLineIds: [lineByRef.R5], journalLineIds: [book.c1] }],
      ['DELETE', `/bank-reconciliations/${reconA}/matches/${someMatch}`, { reason: 'try' }],
      ['POST', `/bank-reconciliations/${reconA}/matches/${someMatch}/unmatch`, { reason: 'try' }],
      ['PATCH', `/bank-reconciliations/${reconA}`, { statementClosingBalance: '1.00' }],
      ['POST', `/bank-accounts/${bankA}/import`, { lines: [{ postedAt: day(12), description: 'BANKTEST late JSON line', amount: 5 }] }],
      ['POST', `/journal-entries/${lateDraftId}/post`, undefined],
      [
        'POST',
        '/journal-entries',
        {
          description: 'BANKTEST backdated',
          postedAt: day(12),
          lines: [
            { accountId: A.accounts.cash, debit: 1, credit: 0 },
            { accountId: A.accounts.ar, debit: 0, credit: 1 },
          ],
        },
      ],
      ['PATCH', `/bank-accounts/${bankA}`, { chartAccountId: A.accounts.ar }],
    ]
    for (const [method, path, body] of tries) {
      const res = await api(acct, method, path, body)
      assert.equal(res.status, 409, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`)
    }
    // Legacy line-only reconcile is retired for everyone.
    assert.equal((await api(acct, 'POST', `/bank-accounts/${lineByRef.R5}/reconcile`)).status, 410)
  })
  // Positive control: entries dated after the signed-off period still post.
  const later = await api(acct, 'POST', '/journal-entries', {
    description: 'BANKTEST after period',
    postedAt: iso(new Date(monthEnd.getTime() + 3 * DAY)),
    lines: [
      { accountId: A.accounts.cash, debit: 1, credit: 0 },
      { accountId: A.accounts.ar, debit: 0, credit: 1 },
    ],
  })
  assert.equal(later.status, 201)
  assert.equal((await api(acct, 'POST', `/journal-entries/${later.body.id}/post`)).status, 200)
})

dbTest('PDF export shows status, signer and balances', async () => {
  const res = await api(A.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconA}/pdf`)
  assert.equal(res.status, 200)
  const pdf = res.body as Buffer
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pdf.subarray(-8).toString().includes('%%EOF'))
  const ws = (await api(A.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconA}`)).body
  const lines = reconciliationReportLines(
    { workspace: ws, snapshotMismatch: false },
    { tenantName: 'banktest-a', generatedAt: new Date(), generatedBy: 'tester' },
  ).map((l) => l.text)
  assert.ok(lines.includes('Status: SIGNED_OFF'))
  const signer = await authDb.user.findUniqueOrThrow({ where: { id: ws.reconciliation.signedOffById } })
  assert.equal(ws.people[ws.reconciliation.signedOffById], `${signer.firstName} ${signer.lastName} <${signer.email}>`)
  assert.ok(lines.some((l) => l.startsWith(`Signed off by: ${signer.firstName} ${signer.lastName} <${signer.email}> at `)))
  assert.ok(lines.includes('Adjusted book balance: 1667.50 USD'))
  assert.ok(lines.includes('Difference: 0.00 USD'))
  assert.ok(lines.some((l) => l.includes('(••••6789)')), 'account number is masked')
})

// ---------------------------------------------------------------------------------------------
// Reopen

dbTest('reopen: wildcard accountant refused, reason required, explicit grant reopens with an audit event', async () => {
  const before = (await api(A.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconA}`)).body.reconciliation
  await assertNoChange(A.id, async () => {
    const wildcard = await api(A.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${reconA}/reopen`, { reason: 'Need to fix a match' })
    assert.equal(wildcard.status, 403)
    assert.equal((await api(A.tokens.MANAGER!, 'POST', `/bank-reconciliations/${reconA}/reopen`, { reason: 'Need to fix a match' })).status, 403)
    assert.equal((await api(A.tokens.TENANT_ADMIN!, 'POST', `/bank-reconciliations/${reconA}/reopen`, { reason: '' })).status, 400)
    assert.equal((await api(A.tokens.TENANT_ADMIN!, 'POST', `/bank-reconciliations/${reconA}/reopen`, {})).status, 400)
  })
  const reason = 'Bank corrected the fee amount on the statement'
  const res = await api(A.tokens.REOPENER!, 'POST', `/bank-reconciliations/${reconA}/reopen`, { reason })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.status, 'IN_PROGRESS')
  assert.equal(res.body.signedOffById, null)
  assert.equal(res.body.reopenedCount, 1)

  const event = await ledgerDb.bankReconciliationEvent.findFirst({ where: { tenantId: A.id, reconciliationId: reconA, action: 'bank_recon.reopened' } })
  const meta = event!.metadata as Record<string, unknown>
  assert.equal(meta.reason, reason)
  assert.equal(meta.previousSignedOffById, before.signedOffById)
  assert.equal(event!.userId, A.userIds.REOPENER)
  const audit = await tenantDb.auditEvent.findFirst({ where: { tenantId: A.id, action: 'bank_recon.reopened' } })
  assert.equal((audit!.metadata as Record<string, unknown>).reason, reason)
  assert.equal(await ledgerDb.bankStatementLine.count({ where: { tenantId: A.id, bankAccountId: bankA, lockedAt: { not: null } } }), 0)
  // Reopening twice is refused.
  await assertNoChange(A.id, async () => {
    assert.equal((await api(A.tokens.TENANT_ADMIN!, 'POST', `/bank-reconciliations/${reconA}/reopen`, { reason })).status, 409)
  })
  // Positive control: the reopened period accepts changes again.
  assert.equal((await api(A.tokens.ACCOUNTANT!, 'PATCH', `/bank-reconciliations/${reconA}`, { dateWindowDays: 4 })).status, 200)
})

dbTest('separation of duties (opt-in rule): preparer cannot sign, a different signer can', async () => {
  RECON_RULES.requireDistinctSigner = true
  try {
    const ws = (await api(A.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconA}`)).body
    assert.equal(ws.reconciliation.preparedById, A.userIds.ACCOUNTANT)
    await assertNoChange(A.id, async () => {
      const own = await api(A.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version: ws.reconciliation.version })
      assert.equal(own.status, 403)
    })
    const other = await api(A.tokens.MANAGER!, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version: ws.reconciliation.version })
    assert.equal(other.status, 200, JSON.stringify(other.body))
    assert.equal(other.body.signedOffById, A.userIds.MANAGER)
  } finally {
    RECON_RULES.requireDistinctSigner = false
  }
})

dbTest('a period that has not ended cannot be signed off', async () => {
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const thisMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
  const created = await api(A.tokens.ACCOUNTANT!, 'POST', '/bank-reconciliations', {
    bankAccountId: bankA,
    periodStart: iso(thisMonthStart),
    periodEnd: iso(thisMonthEnd),
    statementOpeningBalance: '1667.50',
    statementClosingBalance: '1667.50',
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  await assertNoChange(A.id, async () => {
    const res = await api(A.tokens.MANAGER!, 'POST', `/bank-reconciliations/${created.body.id}/sign-off`, { version: created.body.version })
    assert.equal(res.status, 409)
    assert.match(res.body.message, /has not ended/)
  })
})

// ---------------------------------------------------------------------------------------------
// Authorization and tenant isolation

dbTest('roles without finance access are refused everywhere; finance roles are allowed (positive control)', async () => {
  const ws = (await api(A.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconA}`)).body
  const matchId = ws.matched[0].matchId
  const calls: [string, string, unknown][] = [
    ['GET', '/bank-reconciliations', undefined],
    ['GET', `/bank-reconciliations/${reconA}`, undefined],
    ['GET', `/bank-reconciliations/${reconA}/events`, undefined],
    ['GET', `/bank-reconciliations/${reconA}/pdf`, undefined],
    ['POST', '/bank-reconciliations', { bankAccountId: bankA, periodStart: day(1), periodEnd: day(2), statementOpeningBalance: 0, statementClosingBalance: 0 }],
    ['PATCH', `/bank-reconciliations/${reconA}`, { dateWindowDays: 1 }],
    ['POST', `/bank-reconciliations/${reconA}/import-csv`, { csvText: STATEMENT_CSV }],
    ['POST', `/bank-reconciliations/${reconA}/auto-match`, {}],
    ['POST', `/bank-reconciliations/${reconA}/matches`, { statementLineIds: [lineByRef.R5], journalLineIds: [book.c1] }],
    ['DELETE', `/bank-reconciliations/${reconA}/matches/${matchId}`, {}],
    ['POST', `/bank-reconciliations/${reconA}/matches/${matchId}/unmatch`, {}],
    ['POST', `/bank-reconciliations/${reconA}/sign-off`, { version: ws.reconciliation.version }],
    ['POST', `/bank-reconciliations/${reconA}/reopen`, { reason: 'unauthorized attempt' }],
    ['POST', `/bank-accounts/${bankA}/import`, { lines: [{ postedAt: day(5), description: 'BANKTEST x', amount: 1 }] }],
    ['GET', '/bank-accounts', undefined],
  ]
  await assertNoChange(A.id, async () => {
    for (const role of ['SALES_REP', 'VIEWER', 'WAREHOUSE_STAFF', 'STAFF']) {
      for (const [method, path, body] of calls) {
        const res = await api(A.tokens[role]!, method, path, body)
        assert.equal(res.status, 403, `${role} ${method} ${path} → ${res.status}`)
      }
    }
    const anon = await handleApiRequest(new Request(`http://localhost/api/v1/bank-reconciliations/${reconA}`))
    assert.equal(anon.status, 401)
  })
  for (const role of ['ACCOUNTANT', 'MANAGER', 'TENANT_ADMIN', 'PREPARER_ONLY', 'REOPENER']) {
    assert.equal((await api(A.tokens[role]!, 'GET', `/bank-reconciliations/${reconA}`)).status, 200, role)
  }
})

dbTest('tenant isolation: another tenant cannot see or change tenant A records (positive control in own tenant)', async () => {
  const ws = (await api(A.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconA}`)).body
  const matchId = ws.matched[0].matchId
  const bAcct = B.tokens.ACCOUNTANT!
  const bAdmin = B.tokens.TENANT_ADMIN!
  await assertNoChange(A.id, async () => {
    const reads = [`/bank-reconciliations/${reconA}`, `/bank-reconciliations/${reconA}/events`, `/bank-reconciliations/${reconA}/pdf`]
    for (const p of reads) assert.equal((await api(bAcct, 'GET', p)).status, 404, p)
    const list = await api(bAcct, 'GET', '/bank-reconciliations')
    assert.ok(list.body.every((r: { id: string }) => r.id !== reconA))
    const lines = await api(bAcct, 'GET', `/bank-accounts/lines?bankAccountId=${bankA}`)
    assert.equal(lines.body.length, 0)

    const writes: [string, string, string, unknown][] = [
      [bAcct, 'PATCH', `/bank-reconciliations/${reconA}`, { dateWindowDays: 1 }],
      [bAcct, 'POST', `/bank-reconciliations/${reconA}/import-csv`, { csvText: STATEMENT_CSV }],
      [bAcct, 'POST', `/bank-reconciliations/${reconA}/auto-match`, {}],
      [bAcct, 'POST', `/bank-reconciliations/${reconA}/matches`, { statementLineIds: [lineByRef.R5], journalLineIds: [book.c1] }],
      [bAcct, 'DELETE', `/bank-reconciliations/${reconA}/matches/${matchId}`, {}],
      [bAcct, 'POST', `/bank-reconciliations/${reconA}/matches/${matchId}/unmatch`, {}],
      [bAdmin, 'POST', `/bank-reconciliations/${reconA}/sign-off`, { version: ws.reconciliation.version }],
      [bAdmin, 'POST', `/bank-reconciliations/${reconA}/reopen`, { reason: 'cross tenant attempt' }],
      [bAcct, 'POST', '/bank-reconciliations', { bankAccountId: bankA, periodStart: day(1), periodEnd: day(2), statementOpeningBalance: 0, statementClosingBalance: 0 }],
      [bAcct, 'POST', `/bank-accounts/${bankA}/import`, { lines: [{ postedAt: day(5), description: 'BANKTEST x', amount: 1 }] }],
      [bAcct, 'PATCH', `/bank-accounts/${bankA}`, { name: 'hijack' }],
      // Tenant A's line ids used inside tenant B's own reconciliation.
      [bAcct, 'POST', `/bank-reconciliations/${reconB}/matches`, { statementLineIds: [lineByRef.R5], journalLineIds: [book.c1] }],
    ]
    for (const [token, method, path, body] of writes) {
      const res = await api(token, method, path, body)
      assert.equal(res.status, 404, `${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`)
    }
  })
  // Positive control: tenant B works on its own reconciliation.
  const own = await api(bAcct, 'GET', `/bank-reconciliations/${reconB}`)
  assert.equal(own.status, 200)
  assert.equal(own.body.unmatchedBank.length, 0)
  assert.equal((await api(bAcct, 'POST', `/bank-reconciliations/${reconB}/auto-match`, {})).status, 200)
})

// ---------------------------------------------------------------------------------------------
// Legacy summary defects

dbTest('legacy summary: per-account opening balance (D1) and no 300-line cap (D8), in Decimal', async () => {
  const tenantId = `t-${randomUUID()}`
  const one = await createBankAccount(tenantId, { name: 'Operating', openingBalance: 1000 })
  const two = await createBankAccount(tenantId, { name: 'Payroll', openingBalance: '500.10' })
  await ledgerDb.bankStatementLine.createMany({
    data: Array.from({ length: 350 }, (_, i) => ({
      tenantId,
      bankAccountId: i % 2 ? one.id : two.id,
      postedAt: new Date(`${day(5)}T00:00:00Z`),
      description: `line ${i}`,
      amount: new Prisma.Decimal('0.10'),
    })),
  })
  const summary = await getReconciliationSummary(tenantId, { startDate: P_START, endDate: P_END })
  assert.equal(summary.totalDebits, 35, 'all 350 lines counted, exact decimal sum')
  assert.equal(summary.closingBalanceTotal, 1500.1)
  // Nothing reconciled: opening equals current balances (old code subtracted every line once per account).
  assert.equal(summary.openingBalanceTotal, 1500.1)
  await ledgerDb.bankStatementLine.deleteMany({ where: { tenantId } })
  await ledgerDb.bankAccount.deleteMany({ where: { tenantId } })
})

dbTest('bank account responses never include Plaid credentials or sync state', async () => {
  const acct = A.tokens.ACCOUNTANT!
  await ledgerDb.bankAccount.update({
    where: { id: bankA },
    data: { plaidAccessTokenEncrypted: 'enc:BANKTEST-secret', plaidItemId: 'BANKTEST-item', plaidSyncCursor: 'BANKTEST-cursor' },
  })
  try {
    for (const path of ['/bank-accounts', '/bank-accounts?summary=true', '/bank-accounts/lines', '/bank-accounts/unreconciled']) {
      const res = await api(acct, 'GET', path)
      assert.equal(res.status, 200, path)
      const text = JSON.stringify(res.body)
      assert.ok(text.includes(bankA) || path.includes('lines') || path.includes('unreconciled'), `${path} lists the account`)
      assert.ok(!/BANKTEST-(secret|item|cursor)|plaidAccessTokenEncrypted|plaidSyncCursor|plaidItemId/.test(text), `${path} leaks Plaid fields`)
    }
    const renamed = await api(A.tokens.TENANT_ADMIN!, 'PATCH', `/bank-accounts/${bankA}`, { name: 'BANKTEST Operating' })
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body))
    assert.equal(renamed.body.plaidAccessTokenEncrypted, undefined)
  } finally {
    await ledgerDb.bankAccount.update({
      where: { id: bankA },
      data: { plaidAccessTokenEncrypted: null, plaidItemId: null, plaidSyncCursor: null },
    })
  }
})
