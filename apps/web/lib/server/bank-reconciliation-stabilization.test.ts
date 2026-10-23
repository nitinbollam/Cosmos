// Must stay the first import: points every database at fresh temp files before ./db loads.
import { assertIsolated, disposeIsolatedDatabases, prepareIsolatedDatabases } from './test-support/isolated-databases'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma-ledger'
import { handleApiRequest } from '../../server/api-router'
import { loginUser } from './auth'
import { reconciliationReportLines } from './bank-reconciliation-document'
import { encryptSecret } from './crypto-util'
import { authDb, ledgerDb, tenantDb } from './db'
import { syncPlaidTransactions } from './plaid'
import { invalidateUserSessionCache } from './session'

/**
 * Regression tests for the stabilization findings F-1, F-2, F-3, F-5 and F-8 of
 * ticket-analysis/outputs/bank-reconciliation-final-review.md. Every test builds its own tenant in
 * the isolated databases; Plaid is a local stub (no request leaves the process).
 */

// Synthetic, test-only values: the stubbed Plaid never sees a real credential.
process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
process.env.PLAID_ENV = 'sandbox'
process.env.PLAID_CLIENT_ID = 'banktest-client'
process.env.PLAID_SECRET = 'banktest-secret'

const PASSWORD = `bank-recon-${randomUUID()}`
const DAY = 86_400_000
const now = new Date()
const iso = (d: Date) => d.toISOString().slice(0, 10)
/** Two whole past months: P1 (three months back) and P2 (the month after it). */
const p1Start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))
const p1End = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 0))
const p2Start = new Date(p1End.getTime() + DAY)
const p2End = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 0))
const P1 = { start: iso(p1Start), end: iso(p1End), day: (n: number) => iso(new Date(p1Start.getTime() + (n - 1) * DAY)) }
const P2 = { start: iso(p2Start), end: iso(p2End), day: (n: number) => iso(new Date(p2Start.getTime() + (n - 1) * DAY)) }

type Tenant = {
  id: string
  tokens: Record<string, string>
  userIds: Record<string, string>
  accounts: Record<'cash' | 'ar' | 'ap' | 'equity' | 'fees', string>
}

async function makeUser(tenantId: string, role: string, permissions: string[], label: string) {
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

/** A posted two-line entry on the cash account. Returns the cash line id. */
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

async function newBank(t: Tenant, openingBalance = 0) {
  const res = await api(t.tokens.ACCOUNTANT!, 'POST', '/bank-accounts', {
    name: 'BANKTEST Operating',
    accountNumber: '000000001234',
    openingBalance,
    chartAccountId: t.accounts.cash,
    openingBalanceDate: P1.start,
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body.id as string
}

async function newRecon(t: Tenant, bankAccountId: string, p: { start: string; end: string }, opening: string, closing: string) {
  const res = await api(t.tokens.ACCOUNTANT!, 'POST', '/bank-reconciliations', {
    bankAccountId,
    periodStart: p.start,
    periodEnd: p.end,
    statementOpeningBalance: opening,
    statementClosingBalance: closing,
  })
  assert.equal(res.status, 201, JSON.stringify(res.body))
  return res.body.id as string
}

async function workspace(t: Tenant, reconId: string) {
  const res = await api(t.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${reconId}`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return res.body
}

async function signOff(t: Tenant, reconId: string) {
  const ws = await workspace(t, reconId)
  return api(t.tokens.MANAGER!, 'POST', `/bank-reconciliations/${reconId}/sign-off`, { version: ws.reconciliation.version })
}

const csvOf = (rows: [string, string, string, string][]) =>
  ['date,description,amount,reference', ...rows.map((r) => r.join(','))].join('\n')

/** The legacy Bank recon tiles, unfiltered and filtered to a period, as the finance page requests them. */
async function legacyOpening(t: Tenant, p?: { start: string; end: string }) {
  const q = p ? `&startDate=${p.start}&endDate=${p.end}` : ''
  const res = await api(t.tokens.ACCOUNTANT!, 'GET', `/bank-accounts?summary=true${q}`)
  assert.equal(res.status, 200, JSON.stringify(res.body))
  return res.body
}

async function storedBalance(bankAccountId: string) {
  const row = await ledgerDb.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } })
  return new Prisma.Decimal(row.currentBalance).toFixed(2)
}

/**
 * A signed-off period must keep matching what was signed: the recomputed balances equal the
 * snapshot, and no statement line dated inside it was written after the sign-off.
 */
async function assertSignedPeriodIntact(t: Tenant, reconId: string, label: string) {
  const recon = await ledgerDb.bankReconciliation.findUniqueOrThrow({ where: { id: reconId } })
  if (recon.status !== 'SIGNED_OFF') return
  const ws = await workspace(t, reconId)
  assert.equal(ws.balances.adjustedBook, ws.reconciliation.snapshot.adjustedBook, `${label}: adjusted book changed after sign-off`)
  assert.equal(ws.balances.adjustedBank, ws.reconciliation.snapshot.adjustedBank, `${label}: adjusted bank changed after sign-off`)
  assert.equal(ws.balances.bookBalance, ws.reconciliation.snapshot.bookBalance, `${label}: book balance changed after sign-off`)
  const late = await ledgerDb.bankStatementLine.count({
    where: {
      tenantId: t.id,
      bankAccountId: recon.bankAccountId,
      postedAt: { gte: recon.periodStart, lt: new Date(recon.periodEnd.getTime() + DAY) },
      createdAt: { gt: recon.signedOffAt! },
    },
  })
  assert.equal(late, 0, `${label}: a statement line was written into the signed-off period after sign-off`)
}

// ---------------------------------------------------------------------------------------------
// Plaid stub: scripted /transactions/sync pages per access token and cursor. Any other host fails.

type PlaidTxn = { transaction_id: string; date: string; name: string; amount: number }
type PlaidPage = { added?: PlaidTxn[]; modified?: PlaidTxn[]; removed?: { transaction_id: string }[]; next_cursor: string; has_more?: boolean }
const plaidScript = new Map<string, Map<string, PlaidPage>>()
const plaidCalls: string[] = []
const realFetch = globalThis.fetch

function stubPlaid() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith('https://sandbox.plaid.com/')) throw new Error(`test blocked an outbound request to ${new URL(url).host}`)
    const body = JSON.parse(String(init?.body ?? '{}')) as { access_token?: string; cursor?: string }
    const page = plaidScript.get(body.access_token ?? '')?.get(body.cursor ?? '')
    plaidCalls.push(`${new URL(url).pathname} cursor=${body.cursor ?? ''}`)
    if (!url.endsWith('/transactions/sync') || !page) {
      return new Response(JSON.stringify({ error_message: 'not scripted' }), { status: 400 })
    }
    const out = { added: [], modified: [], removed: [], has_more: false, ...page }
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

async function linkPlaid(bankAccountId: string, pages: Record<string, PlaidPage>) {
  const token = `access-sandbox-banktest-${randomUUID()}`
  plaidScript.set(token, new Map(Object.entries(pages)))
  await ledgerDb.bankAccount.update({
    where: { id: bankAccountId },
    data: { plaidAccessTokenEncrypted: encryptSecret(token), plaidItemId: `item-banktest-${randomUUID()}` },
  })
}

async function cursorOf(bankAccountId: string) {
  return (await ledgerDb.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } })).plaidSyncCursor
}

async function syncOutcome(tenantId: string, bankAccountId: string): Promise<{ status: number; message?: string }> {
  try {
    await syncPlaidTransactions(tenantId, bankAccountId)
    return { status: 200 }
  } catch (e) {
    const err = e as { status?: number; message?: string }
    return { status: err.status ?? 500, message: err.message }
  }
}

const lineByRef = (tenantId: string, reference: string) => ledgerDb.bankStatementLine.findFirst({ where: { tenantId, reference } })

// ---------------------------------------------------------------------------------------------
// Interleaving hook for the race tests (F-3)

type AnyFn = (...args: any[]) => any // eslint-disable-line @typescript-eslint/no-explicit-any
const isBoundaryQuery = (args: any) => args?.where?.status === 'SIGNED_OFF' && args?.orderBy?.periodEnd === 'desc' // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Runs `during` once, right after the first "latest signed-off period" read (the lock-boundary
 * check). When that read happens outside a transaction, `during` is awaited before the caller
 * continues: the exact interleaving of a sign-off committing between check and write. Inside a
 * transaction `during` is only started, because a correct writer holds the lock it needs.
 */
function interleaveAtLockCheck(during: () => Promise<unknown>) {
  const delegate = ledgerDb.bankReconciliation as unknown as Record<string, AnyFn>
  const origFindFirst = delegate.findFirst!
  const client = ledgerDb as unknown as Record<string, AnyFn>
  const origTx = client.$transaction!
  let fired: Promise<unknown> | null = null
  let firedInside: boolean | null = null

  delegate.findFirst = async (args: unknown) => {
    const r = await origFindFirst.call(delegate, args)
    if (!fired && isBoundaryQuery(args)) {
      firedInside = false
      fired = during()
      await fired
    }
    return r
  }
  const wrapTx = (tx: object) =>
    new Proxy(tx, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (prop !== 'bankReconciliation') return value
        return new Proxy(value as object, {
          get(d, p, r) {
            const fn = Reflect.get(d, p, r) as AnyFn
            if (p !== 'findFirst') return fn
            return async (args: unknown) => {
              const res = await fn.call(d, args)
              if (!fired && isBoundaryQuery(args)) {
                firedInside = true
                fired = during()
              }
              return res
            }
          },
        })
      },
    })
  client.$transaction = (arg: unknown, opts?: unknown) =>
    typeof arg === 'function' ? origTx.call(ledgerDb, (tx: object) => (arg as AnyFn)(wrapTx(tx)), opts) : origTx.call(ledgerDb, arg, opts)

  return {
    restore() {
      delegate.findFirst = origFindFirst
      client.$transaction = origTx
    },
    settled: async () => (fired ? await fired : undefined),
    get firedInsideTransaction() {
      return firedInside
    },
  }
}

before(async () => {
  assertIsolated()
  await prepareIsolatedDatabases(['auth', 'tenant', 'ledger'])
  stubPlaid()
})

after(async () => {
  globalThis.fetch = realFetch
  invalidateUserSessionCache()
  await disposeIsolatedDatabases()
})

// ---------------------------------------------------------------------------------------------
// F-1 legacy summary opening balance

test('F-1: new-workflow matching never changes the bank opening balance or the legacy summary tile', async () => {
  const t = await makeTenant('f1')
  await postCash(t, iso(new Date(p1Start.getTime() - DAY)), 1000, t.accounts.equity, 'Opening balance')
  await postCash(t, P1.day(2), 250, t.accounts.ar, 'Receipt INV-1')
  await postCash(t, P1.day(3), -120, t.accounts.ap, 'Payment BILL-1')
  await postCash(t, P1.day(5), 75, t.accounts.ar, 'Receipt INV-2')
  const bank = await newBank(t, 1000)
  const recon = await newRecon(t, bank, P1, '1000.00', '1205.00')
  const imp = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/import-csv`, {
    csvText: csvOf([
      [P1.day(3), 'BANKTEST deposit INV-1', '250.00', 'F1-1'],
      [P1.day(4), 'BANKTEST payment BILL-1', '-120.00', 'F1-2'],
      [P1.day(6), 'BANKTEST deposit INV-2', '75.00', 'F1-3'],
    ]),
  })
  assert.equal(imp.status, 201, JSON.stringify(imp.body))

  const expectOpening = async (label: string) => {
    assert.equal((await legacyOpening(t)).openingBalanceTotal, 1000, `${label}: unfiltered opening balance tile`)
    assert.equal((await legacyOpening(t, P1)).openingBalanceTotal, 1000, `${label}: period-filtered opening balance tile`)
    assert.equal(await storedBalance(bank), '1000.00', `${label}: stored bank opening balance`)
  }
  await expectOpening('before matching')
  assert.equal((await legacyOpening(t)).unreconciledCount, 3)

  const auto = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/auto-match`, {})
  assert.equal(auto.status, 200, JSON.stringify(auto.body))
  assert.equal(auto.body.matched, 3)
  await expectOpening('after three matches')
  assert.equal((await legacyOpening(t)).unreconciledCount, 0, 'matched lines no longer count as unreconciled')
  const unrec = await api(t.tokens.ACCOUNTANT!, 'GET', `/bank-accounts/unreconciled?bankAccountId=${bank}`)
  assert.equal(unrec.body.length, 0)

  let ws = await workspace(t, recon)
  assert.equal(ws.balances.bookBalance, '1205.00')
  assert.equal(ws.balances.adjustedBook, '1205.00')
  assert.equal(ws.balances.adjustedBank, '1205.00')
  assert.equal(ws.balances.difference, '0.00')
  assert.equal(ws.unmatchedBank.length + ws.unmatchedBook.length, 0)

  const first = ws.matched[0].matchId
  const un = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/matches/${first}/unmatch`, { reason: 'BANKTEST recheck' })
  assert.equal(un.status, 200, JSON.stringify(un.body))
  await expectOpening('after unmatch')
  assert.equal((await legacyOpening(t)).unreconciledCount, 1)
  ws = await workspace(t, recon)
  const rematch = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/matches`, {
    statementLineIds: [ws.unmatchedBank[0].statementLineId],
    journalLineIds: [ws.unmatchedBook[0].journalLineId],
  })
  assert.equal(rematch.status, 201, JSON.stringify(rematch.body))
  await expectOpening('after rematch')

  assert.equal((await signOff(t, recon)).status, 200)
  await expectOpening('after sign-off')
  ws = await workspace(t, recon)
  assert.equal(ws.reconciliation.snapshot.adjustedBook, '1205.00')
  assert.equal(ws.balances.difference, '0.00')
})

// ---------------------------------------------------------------------------------------------
// F-2 Plaid sync and signed-off periods

test('F-2: a Plaid transaction dated in a signed-off period is refused, the cursor holds, and reopen allows the retry', async () => {
  const t = await makeTenant('f2')
  const bank = await newBank(t)
  const recon = await newRecon(t, bank, P1, '0.00', '0.00')
  await linkPlaid(bank, {
    '': { added: [{ transaction_id: 'f2-a', date: P2.day(5), name: 'BANKTEST card after period', amount: 12.5 }], next_cursor: 'c1' },
    c1: {
      added: [
        { transaction_id: 'f2-b', date: P1.day(10), name: 'BANKTEST late item inside signed period', amount: 7.25 },
        { transaction_id: 'f2-c', date: P2.day(6), name: 'BANKTEST ordinary item', amount: 3 },
      ],
      next_cursor: 'c2',
    },
  })
  assert.equal((await signOff(t, recon)).status, 200)

  // Positive control: an unlocked-period transaction is stored and the cursor advances.
  assert.deepEqual(await syncOutcome(t.id, bank), { status: 200 })
  assert.ok(await lineByRef(t.id, 'f2-a'))
  assert.equal(await cursorOf(bank), 'c1')

  // A page containing a signed-period transaction: refused as a whole, nothing lost, cursor holds.
  const before = await workspace(t, recon)
  const blocked = await syncOutcome(t.id, bank)
  assert.equal(blocked.status, 409, `sync must not silently succeed: ${JSON.stringify(blocked)}`)
  assert.match(blocked.message ?? '', /signed-off reconciliation period/i)
  assert.equal(await cursorOf(bank), 'c1', 'cursor must not move past an unstored transaction')
  assert.equal(await lineByRef(t.id, 'f2-b'), null)
  assert.equal(await lineByRef(t.id, 'f2-c'), null, 'the whole page is rolled back')
  const blockedEvent = await ledgerDb.bankReconciliationEvent.findFirst({ where: { tenantId: t.id, action: 'bank_statement.plaid_sync_blocked' } })
  assert.ok(blockedEvent, 'the refusal is recorded in the audit trail')
  assert.match(JSON.stringify(blockedEvent!.metadata), /f2-b/)
  const after = await workspace(t, recon)
  assert.deepEqual(after.balances, before.balances, 'signed-off figures unchanged')
  await assertSignedPeriodIntact(t, recon, 'after refused sync')

  // Retrying while still signed off is refused again (idempotent), cursor still holds.
  assert.equal((await syncOutcome(t.id, bank)).status, 409)
  assert.equal(await cursorOf(bank), 'c1')

  // Reopen, then the same page is processed.
  const reopened = await api(t.tokens.REOPENER!, 'POST', `/bank-reconciliations/${recon}/reopen`, { reason: 'BANKTEST late Plaid item' })
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body))
  assert.deepEqual(await syncOutcome(t.id, bank), { status: 200 })
  assert.equal(await cursorOf(bank), 'c2')
  const late = await lineByRef(t.id, 'f2-b')
  assert.ok(late && late.amount.toFixed(2) === '-7.25')
  assert.ok(await lineByRef(t.id, 'f2-c'))
  const ws = await workspace(t, recon)
  assert.ok(ws.unmatchedBank.some((b: { reference: string }) => b.reference === 'f2-b'), 'the late item is visible in the reopened period')
})

test('F-2: a Plaid modification or removal of a line in a signed-off period is refused, not ignored', async () => {
  const t = await makeTenant('f2m')
  const bank = await newBank(t)
  const k = await postCash(t, P1.day(10), -5, t.accounts.fees, 'BANKTEST bank fee')
  const recon = await newRecon(t, bank, P1, '0.00', '-5.00')
  await linkPlaid(bank, {
    '': { added: [{ transaction_id: 'f2m-1', date: P1.day(10), name: 'BANKTEST bank fee', amount: 5 }], next_cursor: 'c1' },
    c1: { modified: [{ transaction_id: 'f2m-1', date: P1.day(10), name: 'BANKTEST bank fee', amount: 6 }], next_cursor: 'c2' },
  })
  assert.deepEqual(await syncOutcome(t.id, bank), { status: 200 })
  const line = (await lineByRef(t.id, 'f2m-1'))!
  const m = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/matches`, { statementLineIds: [line.id], journalLineIds: [k] })
  assert.equal(m.status, 201, JSON.stringify(m.body))
  assert.equal((await signOff(t, recon)).status, 200)

  const modified = await syncOutcome(t.id, bank)
  assert.equal(modified.status, 409, JSON.stringify(modified))
  assert.equal(await cursorOf(bank), 'c1')
  assert.equal((await lineByRef(t.id, 'f2m-1'))!.amount.toFixed(2), '-5.00')

  plaidScript.get([...plaidScript.keys()].at(-1)!)!.set('c1', { removed: [{ transaction_id: 'f2m-1' }], next_cursor: 'c2' })
  const removed = await syncOutcome(t.id, bank)
  assert.equal(removed.status, 409, JSON.stringify(removed))
  assert.equal(await cursorOf(bank), 'c1')
  assert.ok(await lineByRef(t.id, 'f2m-1'), 'the signed-off line is kept')
  await assertSignedPeriodIntact(t, recon, 'after refused modification and removal')
})

// ---------------------------------------------------------------------------------------------
// F-3 races with sign-off

test('F-3: sign-off committing at Plaid sync lock check: the Plaid write lands before sign-off or is refused', async () => {
  const t = await makeTenant('f3p')
  const bank = await newBank(t)
  const recon = await newRecon(t, bank, P1, '0.00', '0.00')
  await linkPlaid(bank, { '': { added: [{ transaction_id: 'f3p-1', date: P1.day(12), name: 'BANKTEST racing item', amount: 4 }], next_cursor: 'c1' } })
  const version = (await workspace(t, recon)).reconciliation.version

  let signed: ApiResult | null = null
  const hook = interleaveAtLockCheck(async () => {
    signed = await api(t.tokens.MANAGER!, 'POST', `/bank-reconciliations/${recon}/sign-off`, { version })
  })
  let sync: { status: number; message?: string }
  try {
    sync = await syncOutcome(t.id, bank)
    await hook.settled()
  } finally {
    hook.restore()
  }
  assert.equal(hook.firedInsideTransaction, true, 'the lock-boundary check runs inside the writing, account-locked transaction')
  const signStatus = (signed as ApiResult | null)?.status
  const line = await lineByRef(t.id, 'f3p-1')
  // Either the Plaid line was stored first (and sign-off then saw it: unmatched, so blocked), or
  // sign-off won and Plaid was refused without moving its cursor.
  if (sync.status === 200) {
    assert.ok(line)
    assert.equal(signStatus, 409, `sign-off must see the stored Plaid line (sign-off ${signStatus})`)
  } else {
    assert.equal(sync.status, 409, JSON.stringify(sync))
    assert.equal(signStatus, 200)
    assert.equal(line, null)
    assert.equal(await cursorOf(bank), null)
  }
  await assertSignedPeriodIntact(t, recon, 'Plaid vs sign-off')
})

test('F-3: sign-off racing the legacy JSON import: the import lands before sign-off or is refused', async () => {
  const t = await makeTenant('f3j')
  const bank = await newBank(t)
  const recon = await newRecon(t, bank, P1, '0.00', '0.00')
  const version = (await workspace(t, recon)).reconciliation.version
  let signed: ApiResult | null = null
  const hook = interleaveAtLockCheck(async () => {
    signed = await api(t.tokens.MANAGER!, 'POST', `/bank-reconciliations/${recon}/sign-off`, { version })
  })
  let imp: ApiResult
  try {
    imp = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-accounts/${bank}/import`, {
      lines: [{ postedAt: P1.day(12), description: 'BANKTEST racing JSON line', amount: 4, reference: 'f3j-1' }],
    })
    await hook.settled()
  } finally {
    hook.restore()
  }
  assert.equal(hook.firedInsideTransaction, true, 'the lock-boundary check runs inside the writing, account-locked transaction')
  const signStatus = (signed as ApiResult | null)?.status
  const line = await lineByRef(t.id, 'f3j-1')
  if (imp.status === 201) {
    assert.ok(line)
    assert.equal(signStatus, 409, `sign-off must see the imported line (sign-off ${signStatus})`)
  } else {
    assert.equal(imp.status, 409, JSON.stringify(imp.body))
    assert.equal(signStatus, 200)
    assert.equal(line, null)
  }
  await assertSignedPeriodIntact(t, recon, 'JSON import vs sign-off')

  // Plain concurrent race as well (no hook): same invariant.
  const t2 = await makeTenant('f3j2')
  const bank2 = await newBank(t2)
  const recon2 = await newRecon(t2, bank2, P1, '0.00', '0.00')
  const v2 = (await workspace(t2, recon2)).reconciliation.version
  const [imp2, sign2] = await Promise.all([
    api(t2.tokens.ACCOUNTANT!, 'POST', `/bank-accounts/${bank2}/import`, {
      lines: [{ postedAt: P1.day(13), description: 'BANKTEST concurrent JSON line', amount: 2, reference: 'f3j-2' }],
    }),
    api(t2.tokens.MANAGER!, 'POST', `/bank-reconciliations/${recon2}/sign-off`, { version: v2 }),
  ])
  assert.ok([201, 409].includes(imp2.status), `import → ${imp2.status} ${JSON.stringify(imp2.body)}`)
  assert.ok([200, 409].includes(sign2.status), `sign-off → ${sign2.status} ${JSON.stringify(sign2.body)}`)
  assert.ok(!(imp2.status === 201 && sign2.status === 200), 'an imported, unmatched line cannot be inside a signed-off balanced period')
  await assertSignedPeriodIntact(t2, recon2, 'concurrent JSON import vs sign-off')
})

test('F-3: two imports racing: each statement line is stored once, the loser gets a conflict or skips', async () => {
  const t = await makeTenant('f3i')
  const bank = await newBank(t)
  const recon = await newRecon(t, bank, P1, '0.00', '0.00')
  const csvText = csvOf([
    [P1.day(3), 'BANKTEST race 1', '10.00', 'F3I-1'],
    [P1.day(4), 'BANKTEST race 2', '-4.00', 'F3I-2'],
  ])
  const csv = await Promise.all([
    api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/import-csv`, { csvText }),
    api(t.tokens.MANAGER!, 'POST', `/bank-reconciliations/${recon}/import-csv`, { csvText }),
  ])
  assert.deepEqual(csv.map((r) => r.status).sort(), [201, 409], JSON.stringify(csv.map((r) => r.body)))
  assert.equal(await ledgerDb.bankStatementLine.count({ where: { tenantId: t.id, bankAccountId: bank } }), 2)
  assert.equal(await ledgerDb.bankStatementImport.count({ where: { tenantId: t.id, bankAccountId: bank } }), 1)

  const lines = [
    { postedAt: P1.day(5), description: 'BANKTEST json race 1', amount: 1, reference: 'F3J-1' },
    { postedAt: P1.day(6), description: 'BANKTEST json race 2', amount: 2, reference: 'F3J-2' },
  ]
  const json = await Promise.all([
    api(t.tokens.ACCOUNTANT!, 'POST', `/bank-accounts/${bank}/import`, { lines }),
    api(t.tokens.MANAGER!, 'POST', `/bank-accounts/${bank}/import`, { lines }),
    api(t.tokens.TENANT_ADMIN!, 'POST', `/bank-accounts/${bank}/import`, { lines }),
  ])
  for (const r of json) assert.ok([201, 409].includes(r.status), `JSON import → ${r.status} ${JSON.stringify(r.body)}`)
  for (const ref of ['F3J-1', 'F3J-2']) {
    assert.equal(await ledgerDb.bankStatementLine.count({ where: { tenantId: t.id, reference: ref } }), 1, `${ref} stored once`)
  }
  const created = json.filter((r) => r.status === 201).reduce((n, r) => n + r.body.length, 0)
  assert.equal(created, 2, 'exactly the two new lines were created across all requests')
})

test('F-3: matching and unmatching racing sign-off never change a signed-off period', async () => {
  const t = await makeTenant('f3m')
  const bank = await newBank(t)
  const k1 = await postCash(t, P1.day(3), 50, t.accounts.ar, 'BANKTEST receipt 1')
  const recon = await newRecon(t, bank, P1, '0.00', '50.00')
  await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/import-csv`, {
    csvText: csvOf([[P1.day(4), 'BANKTEST deposit 1', '50.00', 'F3M-1']]),
  })
  const s1 = (await lineByRef(t.id, 'F3M-1'))!.id
  const m = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/matches`, { statementLineIds: [s1], journalLineIds: [k1] })
  assert.equal(m.status, 201)

  // Unmatch vs sign-off on the same period: exactly one wins.
  const version = (await workspace(t, recon)).reconciliation.version
  const [un, sign] = await Promise.all([
    api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${recon}/matches/${m.body.matchId}/unmatch`, { reason: 'BANKTEST race' }),
    api(t.tokens.MANAGER!, 'POST', `/bank-reconciliations/${recon}/sign-off`, { version }),
  ])
  assert.deepEqual([un.status, sign.status].sort(), [200, 409], JSON.stringify([un.body, sign.body]))
  if (sign.status === 200) {
    const active = await ledgerDb.bankReconciliationMatch.findUniqueOrThrow({ where: { id: m.body.matchId } })
    assert.equal(active.unmatchedAt, null, 'the signed-off match stays active')
  }
  await assertSignedPeriodIntact(t, recon, 'unmatch vs sign-off')

  // Match in the next period racing sign-off of this one (both may succeed; this one must not change).
  const t2 = await makeTenant('f3m2')
  const bank2 = await newBank(t2)
  const ka = await postCash(t2, P1.day(3), 50, t2.accounts.ar, 'BANKTEST receipt A')
  const kb = await postCash(t2, P2.day(3), 20, t2.accounts.ar, 'BANKTEST receipt B')
  const r1 = await newRecon(t2, bank2, P1, '0.00', '50.00')
  const r2 = await newRecon(t2, bank2, P2, '50.00', '70.00')
  await api(t2.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r1}/import-csv`, { csvText: csvOf([[P1.day(4), 'BANKTEST deposit A', '50.00', 'A']]) })
  await api(t2.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r2}/import-csv`, { csvText: csvOf([[P2.day(4), 'BANKTEST deposit B', '20.00', 'B']]) })
  const sa = (await lineByRef(t2.id, 'A'))!.id
  const sb = (await lineByRef(t2.id, 'B'))!.id
  assert.equal((await api(t2.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r1}/matches`, { statementLineIds: [sa], journalLineIds: [ka] })).status, 201)
  const v1 = (await workspace(t2, r1)).reconciliation.version
  const [mb, s1res] = await Promise.all([
    api(t2.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r2}/matches`, { statementLineIds: [sb], journalLineIds: [kb] }),
    api(t2.tokens.MANAGER!, 'POST', `/bank-reconciliations/${r1}/sign-off`, { version: v1 }),
  ])
  assert.ok([201, 409].includes(mb.status), JSON.stringify(mb.body))
  assert.ok([200, 409].includes(s1res.status), JSON.stringify(s1res.body))
  await assertSignedPeriodIntact(t2, r1, 'next-period match vs sign-off')
  // After sign-off, the signed period refuses matching and unmatching (the period lock).
  if (s1res.status === 200) {
    const ws1 = await workspace(t2, r1)
    const again = await api(t2.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r1}/matches/${ws1.matched[0].matchId}/unmatch`, {})
    assert.equal(again.status, 409)
  }
})

// ---------------------------------------------------------------------------------------------
// F-5 matches across periods

test('F-5: an item matched in another period is not offered, auto-matched or blocking in any other period', async () => {
  const t = await makeTenant('f5')
  const bank = await newBank(t)
  // P1: deposit booked day 29, on the statement day 30 (both in P1).
  const k1 = await postCash(t, P1.day(29), 100, t.accounts.ar, 'BANKTEST receipt INV-5')
  // A P1 bank fee that was only booked in P2.
  const k2 = await postCash(t, P2.day(1), -10, t.accounts.fees, 'BANKTEST fee booked late')
  // The later period is prepared first and matches both P1 bank items.
  const r2 = await newRecon(t, bank, P2, '90.00', '90.00')
  const imp = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-accounts/${bank}/import`, {
    lines: [
      { postedAt: P1.day(30), description: 'BANKTEST deposit INV-5', amount: 100, reference: 'F5-1' },
      { postedAt: P1.end, description: 'BANKTEST fee', amount: -10, reference: 'F5-2' },
    ],
  })
  assert.equal(imp.status, 201, JSON.stringify(imp.body))
  const s1 = (await lineByRef(t.id, 'F5-1'))!.id
  const s2 = (await lineByRef(t.id, 'F5-2'))!.id
  const m1 = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r2}/matches`, { statementLineIds: [s1], journalLineIds: [k1] })
  const m2 = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r2}/matches`, { statementLineIds: [s2], journalLineIds: [k2] })
  assert.equal(m1.status, 201, JSON.stringify(m1.body))
  assert.equal(m2.status, 201, JSON.stringify(m2.body))

  const r1 = await newRecon(t, bank, P1, '0.00', '90.00')
  let ws1 = await workspace(t, r1)
  const openBank = ws1.unmatchedBank.map((b: { statementLineId: string }) => b.statementLineId)
  const openBook = ws1.unmatchedBook.map((b: { journalLineId: string }) => b.journalLineId)
  assert.ok(!openBank.includes(s1) && !openBank.includes(s2), 'bank items matched in P2 are not offered in P1')
  assert.ok(!openBook.includes(k1), 'book item matched in P2 is not offered in P1')
  assert.equal(ws1.autoMatchPreview.pairs.length, 0)
  // Balances: the P1/P1 pair clears as of P1; the P1 fee matched to a P2 entry is still a P1 reconciling item.
  assert.equal(ws1.balances.bookBalance, '100.00')
  assert.equal(ws1.balances.depositsInTransit, '0.00')
  assert.equal(ws1.balances.unrecordedBankItems, '-10.00')
  assert.equal(ws1.balances.difference, '0.00')
  assert.equal(ws1.otherPeriodMatches.length, 2)
  assert.deepEqual(
    ws1.otherPeriodMatches.map((x: { clearedAsOfThisPeriod: boolean }) => x.clearedAsOfThisPeriod).sort(),
    [false, true],
  )
  assert.deepEqual(ws1.signOff.blockers, [], 'already-matched items do not block sign-off')

  const auto = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r1}/auto-match`, {})
  assert.equal(auto.status, 200, `auto-match must not report a concurrency conflict: ${JSON.stringify(auto.body)}`)
  assert.equal(auto.body.matched, 0)
  const manual = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r1}/matches`, { statementLineIds: [s1], journalLineIds: [k1] })
  assert.equal(manual.status, 409)
  assert.ok(manual.body.message.includes(`${P2.start} to ${P2.end}`), `accurate error names the other period: ${manual.body.message}`)
  assert.doesNotMatch(manual.body.message, /same time/)

  const signed = await signOff(t, r1)
  assert.equal(signed.status, 200, JSON.stringify(signed.body))
  const signedWs = await workspace(t, r1)

  // P2 still owns its matches and balances.
  const ws2 = await workspace(t, r2)
  assert.equal(ws2.matched.length, 2)
  assert.equal(ws2.balances.difference, '0.00')

  // Unmatch in P2 keeps history and makes the items available again in P2; signed P1 is unchanged.
  const un = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r2}/matches/${m1.body.matchId}/unmatch`, { reason: 'BANKTEST recheck' })
  assert.equal(un.status, 200, JSON.stringify(un.body))
  const ws2b = await workspace(t, r2)
  assert.ok(ws2b.unmatchedBank.some((b: { statementLineId: string }) => b.statementLineId === s1))
  assert.equal(await ledgerDb.bankReconciliationMatch.count({ where: { id: m1.body.matchId, unmatchedAt: { not: null } } }), 1)
  ws1 = await workspace(t, r1)
  assert.deepEqual(ws1.balances, signedWs.balances, 'signed P1 figures unchanged by a later unmatch')
  assert.deepEqual(ws1.unmatchedBank, signedWs.unmatchedBank)
  assert.deepEqual(ws1.otherPeriodMatches, signedWs.otherPeriodMatches)
  await assertSignedPeriodIntact(t, r1, 'after P2 unmatch')
  const re = await api(t.tokens.ACCOUNTANT!, 'POST', `/bank-reconciliations/${r2}/matches`, { statementLineIds: [s1], journalLineIds: [k1] })
  assert.equal(re.status, 201, JSON.stringify(re.body))
})

// ---------------------------------------------------------------------------------------------
// F-8 actor names

test('F-8: audit and match rows name same-tenant users; unknown, deleted and other-tenant users get a safe label', async () => {
  const t = await makeTenant('f8')
  const other = await makeTenant('f8-other')
  const bank = await newBank(t)
  const recon = await newRecon(t, bank, P1, '0.00', '0.00')
  assert.equal((await signOff(t, recon)).status, 200)
  assert.equal((await api(t.tokens.REOPENER!, 'POST', `/bank-reconciliations/${recon}/reopen`, { reason: 'BANKTEST names check' })).status, 200)

  // A same-tenant user who later disappears, and a user id that belongs to another tenant.
  const gone = await authDb.user.create({
    data: { tenantId: t.id, email: `gone-${randomUUID().slice(0, 8)}@example.test`, passwordHash: 'x', firstName: 'Gone', lastName: 'User', role: 'ACCOUNTANT' as never, permissions: [] },
  })
  for (const userId of [gone.id, other.userIds.ACCOUNTANT!]) {
    await ledgerDb.bankReconciliationEvent.create({
      data: { tenantId: t.id, bankAccountId: bank, reconciliationId: recon, action: 'bank_recon.updated', userId, metadata: {} },
    })
  }
  await authDb.user.delete({ where: { id: gone.id } })

  const events = await api(t.tokens.ACCOUNTANT!, 'GET', `/bank-reconciliations/${recon}/events`)
  assert.equal(events.status, 200)
  const reopenRow = events.body.find((e: { action: string }) => e.action === 'bank_recon.reopened')
  const reopener = await authDb.user.findUniqueOrThrow({ where: { id: t.userIds.REOPENER! } })
  assert.equal(reopenRow.actorName, `${reopener.firstName} ${reopener.lastName} <${reopener.email}>`)
  const goneRow = events.body.find((e: { userId: string }) => e.userId === gone.id)
  const foreignRow = events.body.find((e: { userId: string }) => e.userId === other.userIds.ACCOUNTANT)
  assert.equal(goneRow.actorName, 'Deleted or unavailable user')
  assert.equal(foreignRow.actorName, 'Deleted or unavailable user', 'no cross-tenant name lookup')
  const otherUser = await authDb.user.findUniqueOrThrow({ where: { id: other.userIds.ACCOUNTANT! } })
  assert.ok(!JSON.stringify(events.body).includes(otherUser.email), 'another tenant user is never named')
  for (const e of events.body) {
    assert.equal(typeof e.actorName, 'string')
    assert.notEqual(e.actorName, e.userId, 'no raw id as a display name')
  }

  // The workspace people map covers everyone it references, with the same fallback.
  const ws = await workspace(t, recon)
  assert.equal(ws.people[t.userIds.REOPENER!], reopenRow.actorName)
  assert.equal(ws.people[gone.id], 'Deleted or unavailable user')
  assert.equal(ws.people[other.userIds.ACCOUNTANT!], 'Deleted or unavailable user')

  // PDF lines never print a raw id: a match by a deleted user prints the fallback label.
  const report = reconciliationReportLines(
    { workspace: { ...ws, reconciliation: { ...ws.reconciliation, preparedById: gone.id } }, snapshotMismatch: false },
    { tenantName: 'f8', generatedAt: new Date(), generatedBy: 'tester' },
  ).map((l) => l.text)
  assert.ok(report.includes('Prepared by: Deleted or unavailable user' + (ws.reconciliation.preparedAt ? ` at ${ws.reconciliation.preparedAt}` : '')))
  assert.ok(!report.some((l) => l.includes(gone.id)))
})
