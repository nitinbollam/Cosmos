/**
 * Synthetic BANKTEST fixture for the local bank-reconciliation demo. Creates every schema in the
 * brand-new SQLite files of the run's temp directory and adds one synthetic tenant. Run it only
 * through launch.mjs: it refuses unless every database URL points into that directory, and refuses
 * a directory that already holds database files. The user password comes from
 * BANKTEST_DEMO_PASSWORD (synthetic, set by the person running the demo); it is never stored here.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCHEMAS, WEB_ROOT, assertDisposableEnv } from './disposable-env.mjs'

type Client = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const DEMO_USERS = {
  accountant: 'banktest-accountant@example.test',
  preparer: 'banktest-preparer@example.test',
  admin: 'banktest-admin@example.test',
  sales: 'banktest-sales@example.test',
}

async function main() {
  const dir = process.env.BANKTEST_DEMO_TMP ?? ''
  assertDisposableEnv(process.env, dir)
  const password = process.env.BANKTEST_DEMO_PASSWORD ?? ''
  if (password.length < 12) throw new Error('BANKTEST_DEMO_PASSWORD must be set to a synthetic password of at least 12 characters')
  if (fs.readdirSync(dir).some((f) => f.endsWith('.db'))) throw new Error('Refusing: the demo directory already has databases')
  console.log(`[fixture] provider=sqlite target=<os-temp>/${path.basename(dir)} (${Object.keys(SCHEMAS).length} new files)`)

  const db = (await import(pathToFileURL(path.join(WEB_ROOT, 'lib/server/db.ts')).href)) as Client
  const webRequire = createRequire(path.join(WEB_ROOT, 'package.json'))
  const prismaCli = webRequire.resolve('prisma/build/index.js')
  for (const [schema, [, client]] of Object.entries(SCHEMAS)) {
    // Offline SQL generation for an empty database: no db push, no migrate, no seed.
    const sql = execFileSync(
      process.execPath,
      [prismaCli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(WEB_ROOT, 'prisma', schema, 'schema.prisma'), '--script'],
      { env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const stmts = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean)
    for (const stmt of stmts) await db[client].$executeRawUnsafe(stmt)
  }
  console.log('[fixture] schemas created')

  const bcrypt = webRequire('bcrypt') as { hash: (p: string, r: number) => Promise<string> }
  const tenantId = 't-banktest-demo'
  await db.authDb.tenant.create({ data: { id: tenantId, name: 'BANKTEST Demo Co', slug: 'banktest-demo', settings: {} } })
  await db.tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: 'banktest-demo', displayName: 'BANKTEST Demo Co', onboardingPhase: 'READY', settings: {}, metadata: {} },
  })
  const hash = await bcrypt.hash(password, 10)
  const users: [string, string, string, string[]][] = [
    [DEMO_USERS.accountant, 'Avery', 'ACCOUNTANT', []],
    [DEMO_USERS.preparer, 'Parker', 'ACCOUNTANT', ['finance.read', 'finance.reconcile']],
    [DEMO_USERS.admin, 'Morgan', 'TENANT_ADMIN', []],
    [DEMO_USERS.sales, 'Sasha', 'SALES_REP', []],
  ]
  for (const [email, firstName, role, permissions] of users) {
    await db.authDb.user.create({
      data: { tenantId, email, passwordHash: hash, firstName, lastName: 'Banktest', role, permissions, emailVerifiedAt: new Date() },
    })
  }

  const chart = async (code: string, name: string, type: string) =>
    (await db.ledgerDb.chartAccount.create({ data: { tenantId, code, name, type } })).id
  const cash = await chart('1000', 'Cash - Operating (BANKTEST)', 'ASSET')
  await chart('1010', 'Cash - Payroll (BANKTEST)', 'ASSET')
  const ar = await chart('1200', 'Accounts receivable', 'ASSET')
  const ap = await chart('2100', 'Accounts payable', 'LIABILITY')
  const equity = await chart('3000', 'Owner equity', 'EQUITY')
  const fees = await chart('6100', 'Bank fees', 'EXPENSE')
  const interest = await chart('4900', 'Interest income', 'REVENUE')

  const bank = await db.ledgerDb.bankAccount.create({
    data: {
      tenantId,
      name: 'BANKTEST Operating',
      accountNumber: '000000006789',
      chartAccountId: cash,
      openingBalanceDate: new Date('2026-09-01T00:00:00Z'),
      currentBalance: 1000,
    },
  })
  await db.ledgerDb.bankAccount.create({ data: { tenantId, name: 'BANKTEST Payroll (unlinked)', accountNumber: '000000004321' } })

  const entry = async (date: string, description: string, amount: number, other: string, isPosted = true) => {
    const debitCash = amount > 0
    const abs = Math.abs(amount).toFixed(2)
    return db.ledgerDb.journalEntry.create({
      data: {
        tenantId,
        description,
        isPosted,
        postedAt: new Date(`${date}T12:00:00Z`),
        lines: {
          create: [
            { accountId: cash, debit: debitCash ? abs : '0', credit: debitCash ? '0' : abs },
            { accountId: other, debit: debitCash ? '0' : abs, credit: debitCash ? abs : '0' },
          ],
        },
      },
    })
  }
  await entry('2026-08-31', 'BANKTEST opening balance', 1000, equity)
  await entry('2026-09-02', 'BANKTEST receipt INV-1001', 250, ar)
  await entry('2026-09-03', 'BANKTEST payment BILL-2001', -120, ap)
  await entry('2026-09-15', 'BANKTEST receipt INV-1002', 75, ar)
  await entry('2026-09-16', 'BANKTEST receipt INV-1003', 75, ar)
  await entry('2026-09-20', 'BANKTEST receipt INV-1004', 180, ar)
  await entry('2026-09-20', 'BANKTEST receipt INV-1005', 120, ar)
  await entry('2026-09-22', 'BANKTEST receipt INV-1006', 100, ar)
  await entry('2026-09-29', 'BANKTEST cheque 1042 to supplier', -200, ap)
  await entry('2026-09-30', 'BANKTEST receipt INV-1007 (deposit in transit)', 50, ar)
  // Booked in October for a September bank credit: used by the cross-period (F-5) check.
  await entry('2026-10-01', 'BANKTEST September interest booked in October', 5, interest)
  const fee = await entry('2026-09-28', 'BANKTEST adjusting entry: September bank service fee', -15, fees, false)
  const late = await entry('2026-09-12', 'BANKTEST late backdated receipt (draft)', 10, ar, false)

  // Ids for the browser test, written next to the databases (inside the temp directory only).
  fs.writeFileSync(path.join(dir, 'fixture-ids.json'), JSON.stringify({ bankAccountId: bank.id, feeDraftId: fee.id, lateDraftId: late.id }, null, 2))
  console.log('[fixture] tenant "BANKTEST Demo Co": 4 users, 7 GL accounts, 2 bank accounts, 11 posted + 2 draft journal entries')
  for (const [, client] of Object.values(SCHEMAS)) await db[client].$disconnect()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
