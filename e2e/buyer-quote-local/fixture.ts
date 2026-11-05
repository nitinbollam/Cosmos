/**
 * Synthetic QTEST tenant for the buyer quote browser checks. Builds every schema in the run's brand-new SQLite
 * files (offline `prisma migrate diff --from-empty`, never db push / migrate / seed) and adds one tenant:
 * a portal buyer with its CRM customer, a manager, a read-only staff user, a warehouse and three products with stock,
 * plus a second tenant with one manager (tenant isolation checks).
 * Run only through launch.mjs: it refuses unless every database URL points into the run's temp folder,
 * and refuses a folder that already holds database files. The password comes from QTEST_DEMO_PASSWORD
 * (random per run, set by launch.mjs).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SCHEMAS as UNTYPED_SCHEMAS, WEB_ROOT, assertDisposableEnv } from '../bank-reconciliation-local/disposable-env.mjs'

/** schema folder → [database name, client export name] (disposable-env.mjs has no type declarations). */
const SCHEMAS = UNTYPED_SCHEMAS as Record<string, [string, string]>

type Client = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const QTEST_USERS = {
  buyer: 'qtest-buyer@example.test',
  manager: 'qtest-manager@example.test',
  /** Phase 7: staff who may read quotes but not decide them (explicit permissions override the role's). */
  reader: 'qtest-reader@example.test',
  /** Phase 7: a manager in a second tenant, for tenant isolation checks. */
  otherManager: 'qtest-other-manager@example.test',
}

async function main() {
  const dir = process.env.BANKTEST_DEMO_TMP ?? ''
  assertDisposableEnv(process.env, dir)
  const password = process.env.QTEST_DEMO_PASSWORD ?? ''
  if (password.length < 12) throw new Error('QTEST_DEMO_PASSWORD must be set (launch.mjs sets a random one)')
  if (fs.readdirSync(dir).some((f) => f.endsWith('.db'))) throw new Error('Refusing: the folder already has databases')
  console.log(`[fixture] target=<os-temp>/${path.basename(dir)} (${Object.keys(SCHEMAS).length} new files)`)

  const db = (await import(pathToFileURL(path.join(WEB_ROOT, 'lib/server/db.ts')).href)) as Client
  const webRequire = createRequire(path.join(WEB_ROOT, 'package.json'))
  const prismaCli = webRequire.resolve('prisma/build/index.js')
  for (const [schema, [, client]] of Object.entries(SCHEMAS)) {
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
  const tenantId = 't-qtest-demo'
  await db.authDb.tenant.create({ data: { id: tenantId, name: 'QTEST Demo Supply', slug: 'qtest-demo', settings: {} } })
  await db.tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: 'qtest-demo', displayName: 'QTEST Demo Supply', onboardingPhase: 'READY', settings: { salesTaxRate: 0 }, metadata: {} },
  })
  const hash = await bcrypt.hash(password, 10)
  // Portal buyer: STAFF role, matched to its CRM customer by email (as the portal login does).
  for (const [email, firstName, role] of [
    [QTEST_USERS.buyer, 'Blake', 'STAFF'],
    [QTEST_USERS.manager, 'Morgan', 'MANAGER'],
  ] as const) {
    await db.authDb.user.create({
      data: { tenantId, email, passwordHash: hash, firstName, lastName: 'Qtest', role, permissions: [], emailVerifiedAt: new Date() },
    })
  }
  await db.authDb.user.create({
    data: {
      tenantId, email: QTEST_USERS.reader, passwordHash: hash, firstName: 'Riley', lastName: 'Qtest', role: 'ACCOUNTANT',
      permissions: ['quotes.read', 'orders.read'], emailVerifiedAt: new Date(),
    },
  })
  const otherTenantId = 't-qtest-other'
  await db.authDb.tenant.create({ data: { id: otherTenantId, name: 'QTEST Other Supply', slug: 'qtest-other', settings: {} } })
  await db.tenantDb.tenantOrganization.create({
    data: { id: otherTenantId, slug: 'qtest-other', displayName: 'QTEST Other Supply', onboardingPhase: 'READY', settings: { salesTaxRate: 0 }, metadata: {} },
  })
  await db.authDb.user.create({
    data: {
      tenantId: otherTenantId, email: QTEST_USERS.otherManager, passwordHash: hash, firstName: 'Olive', lastName: 'Qtest', role: 'MANAGER',
      permissions: [], emailVerifiedAt: new Date(),
    },
  })
  const customer = await db.crmDb.customer.create({ data: { tenantId, name: 'QTEST Buyer Co', email: QTEST_USERS.buyer } })

  const wh = await db.inventoryDb.warehouse.create({ data: { tenantId, name: 'Main', code: 'MAIN', address: {}, isDefault: true } })
  const skus = [
    ['QT-PEN-01', 'QTEST Ballpoint pens (box)', '24'],
    ['QT-PAD-02', 'QTEST Legal pads (pack)', '8.5'],
    ['QT-INK-03', 'QTEST Ink cartridge', '31.25'],
  ]
  for (const [code, name, price] of skus) {
    const sku = await db.inventoryDb.sKU.create({
      data: { tenantId, code, name, category: 'Office', cost: '5', price, imageUrls: [], attributes: {}, isActive: true },
    })
    await db.inventoryDb.stockLevel.create({
      data: { tenantId, skuId: sku.id, warehouseId: wh.id, batchId: '', quantityOnHand: 100000, quantityAvailable: 100000 },
    })
  }
  // Phase 7: states the API can't produce on demand. An EXPIRED quote, and a legacy quote (no recorded creator) with
  // two legacy offers (no recorded side): one labelled BUYER, which staff may accept, and one labelled ADMIN, which
  // nobody may accept.
  const line = { lineNo: 1, skuCode: 'QT-PEN-01', description: 'QTEST Ballpoint pens (box)', qty: 4, unitPrice: '24' }
  const expired = await db.storefrontDb.b2BQuote.create({
    data: { tenantId, customerRef: customer.id, status: 'EXPIRED', notes: 'QTEST expired quote', lines: { create: [line] } },
  })
  const legacy = await db.storefrontDb.b2BQuote.create({
    data: { tenantId, customerRef: customer.id, status: 'OPEN', notes: 'QTEST legacy quote', lines: { create: [line] } },
  })
  for (const [offeredBy, price] of [['ADMIN', '22'], ['BUYER', '21']]) {
    await db.storefrontDb.quoteCounterOffer.create({
      data: { quoteId: legacy.id, offeredBy, status: 'OPEN', lines: { create: [{ lineNo: 1, qty: 4, unitPrice: price }] } },
    })
  }
  fs.writeFileSync(
    path.join(dir, 'fixture-ids.json'),
    JSON.stringify({ tenantId, customerId: customer.id, skus: skus.map((s) => s[0]), expiredQuoteId: expired.id, legacyQuoteId: legacy.id }, null, 2),
  )
  console.log('[fixture] tenant "QTEST Demo Supply": 1 portal buyer + customer, 1 manager, 1 read-only staff, 1 warehouse, 3 products; tenant "QTEST Other Supply": 1 manager')
  for (const [, client] of Object.values(SCHEMAS)) await db[client].$disconnect()
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
