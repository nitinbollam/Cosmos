import test, { after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { ledgerDb, orderDb } from './db'
import {
  TenantScopeError,
  bindRequestTenant,
  resetTenantScopeReport,
  runInRequestScope,
  runUnscoped,
  runWithTenant,
  scopeArgs,
  setTenantScopeModeForTests,
  tenantScopeReport,
} from './tenant-scope'
import { TENANT_EXEMPT_MODELS } from './tenant-scope-models'

afterEach(() => {
  setTenantScopeModeForTests(null)
  resetTenantScopeReport()
})
after(() => setTenantScopeModeForTests(null))

const ids = () => ({ a: `ta-${randomUUID()}`, b: `tb-${randomUUID()}` })

async function seedAccount(tenantId: string) {
  return runUnscoped('test seed', () =>
    ledgerDb.chartAccount.create({ data: { tenantId, code: '1200', name: 'AR', type: 'ASSET' } }),
  )
}
const rawAccount = (id: string) => runUnscoped('test read', () => ledgerDb.chartAccount.findUnique({ where: { id } }))

// ---------------------------------------------------------------- pure argument rewriting

test('scopeArgs adds the tenant to every filtering operation', () => {
  for (const op of ['findFirst', 'findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany', 'findUnique', 'update', 'delete']) {
    const r = scopeArgs(op, { where: { id: 'x' } }, 'T', true)
    assert.deepEqual(r.args?.where, { id: 'x', tenantId: 'T' }, op)
    assert.deepEqual(r.violations, ['missing-filter'], op)
  }
  assert.deepEqual(scopeArgs('findMany', undefined, 'T', true).args?.where, { tenantId: 'T' })
})

test('scopeArgs leaves a correct filter alone and flags a wrong one', () => {
  assert.deepEqual(scopeArgs('findMany', { where: { tenantId: 'T' } }, 'T', true).violations, [])
  assert.deepEqual(scopeArgs('findMany', { where: { tenantId: { equals: 'T' } } }, 'T', true).violations, [])
  assert.deepEqual(scopeArgs('findMany', { where: { tenantId: 'OTHER' } }, 'T', true).violations, ['mismatching-tenant'])
})

test('scopeArgs fills tenantId on create and flags another tenant', () => {
  assert.deepEqual(scopeArgs('create', { data: { code: 'x' } }, 'T', true).args?.data, { code: 'x', tenantId: 'T' })
  assert.deepEqual(scopeArgs('create', { data: { tenantId: 'OTHER' } }, 'T', true).violations, ['create-for-other-tenant'])
  const many = scopeArgs('createMany', { data: [{ a: 1 }, { a: 2, tenantId: 'T' }] }, 'T', true)
  assert.deepEqual(many.args?.data, [{ a: 1, tenantId: 'T' }, { a: 2, tenantId: 'T' }])
  const up = scopeArgs('upsert', { where: { id: 'x' }, create: { a: 1 }, update: {} }, 'T', true)
  assert.deepEqual(up.args?.where, { id: 'x', tenantId: 'T' })
  assert.deepEqual(up.args?.create, { a: 1, tenantId: 'T' })
})

test('scopeArgs refuses to move a row to another tenant', () => {
  assert.deepEqual(scopeArgs('update', { where: { id: 'x', tenantId: 'T' }, data: { tenantId: 'OTHER' } }, 'T', true).violations, [
    'create-for-other-tenant',
  ])
})

test('audit mode reports but never rewrites', () => {
  const r = scopeArgs('findMany', { where: { id: 'x' } }, 'T', false)
  assert.deepEqual(r.args?.where, { id: 'x' })
  assert.deepEqual(r.violations, ['missing-filter'])
})

// ---------------------------------------------------------------- against the real clients

test('enforce: a cross-tenant id returns null for read and fails for update and delete, leaving the row untouched', async () => {
  setTenantScopeModeForTests('enforce')
  const { a, b } = ids()
  const rowB = await seedAccount(b)

  assert.equal(await runWithTenant(a, () => ledgerDb.chartAccount.findUnique({ where: { id: rowB.id } })), null)
  assert.equal(await runWithTenant(a, () => ledgerDb.chartAccount.findFirst({ where: { id: rowB.id } })), null)
  await assert.rejects(
    runWithTenant(a, () => ledgerDb.chartAccount.update({ where: { id: rowB.id }, data: { name: 'hacked' } })),
  )
  await assert.rejects(runWithTenant(a, () => ledgerDb.chartAccount.delete({ where: { id: rowB.id } })))
  assert.equal((await runWithTenant(a, () => ledgerDb.chartAccount.updateMany({ where: { id: rowB.id }, data: { name: 'hacked' } }))).count, 0)
  assert.equal((await runWithTenant(a, () => ledgerDb.chartAccount.deleteMany({ where: { id: rowB.id } }))).count, 0)
  assert.equal(await runWithTenant(a, () => ledgerDb.chartAccount.count()), 0)
  assert.deepEqual(await runWithTenant(a, () => ledgerDb.chartAccount.findMany()), [])

  const after = await rawAccount(rowB.id)
  assert.equal(after?.name, 'AR')
  assert.equal(await runWithTenant(b, () => ledgerDb.chartAccount.count()), 1)
})

test('enforce: an unguarded write by bare id still only touches the caller\'s own tenant', async () => {
  setTenantScopeModeForTests('enforce')
  const { a } = ids()
  const own = await seedAccount(a)
  const updated = await runWithTenant(a, () => ledgerDb.chartAccount.update({ where: { id: own.id }, data: { name: 'renamed' } }))
  assert.equal(updated.name, 'renamed')
})

test('enforce: creating a row for another tenant is rejected, and a missing tenantId is filled in', async () => {
  setTenantScopeModeForTests('enforce')
  const { a, b } = ids()
  await assert.rejects(
    runWithTenant(a, () => ledgerDb.chartAccount.create({ data: { tenantId: b, code: '9', name: 'x', type: 'ASSET' } })),
    TenantScopeError,
  )
  assert.equal(await rawCount(b), 0)
  const filled = await runWithTenant(a, () =>
    ledgerDb.chartAccount.create({ data: { code: '9', name: 'x', type: 'ASSET' } as never }),
  )
  assert.equal(filled.tenantId, a)
})
const rawCount = (tenantId: string) => runUnscoped('test count', () => ledgerDb.chartAccount.count({ where: { tenantId } }))

test('enforce: a caller-supplied filter for another tenant throws instead of returning data', async () => {
  setTenantScopeModeForTests('enforce')
  const { a, b } = ids()
  await seedAccount(b)
  await assert.rejects(runWithTenant(a, () => ledgerDb.chartAccount.findMany({ where: { tenantId: b } })), TenantScopeError)
})

test('enforce: upsert and interactive transactions are scoped too', async () => {
  setTenantScopeModeForTests('enforce')
  const { a, b } = ids()
  const rowB = await seedAccount(b)
  // B's row is not matched for tenant A, so the upsert takes its create branch for A and leaves B alone.
  const up = await runWithTenant(a, () =>
    ledgerDb.chartAccount.upsert({
      where: { id: rowB.id },
      update: { name: 'hacked' },
      create: { tenantId: a, code: '1', name: 'n', type: 'ASSET' },
    }),
  )
  assert.equal(up.tenantId, a)
  assert.notEqual(up.id, rowB.id)
  assert.equal((await rawAccount(rowB.id))?.name, 'AR')

  const seen = await runWithTenant(a, () =>
    ledgerDb.$transaction(async (tx) => {
      await tx.chartAccount.create({ data: { code: '7', name: 'in tx', type: 'ASSET' } as never })
      return tx.chartAccount.findMany()
    }),
  )
  assert.ok(seen.some((r) => r.name === 'in tx'))
  assert.ok(seen.every((r) => r.tenantId === a))
})

test('interleaved jobs for different tenants never see each other\'s rows', async () => {
  setTenantScopeModeForTests('enforce')
  const tenants = Array.from({ length: 6 }, () => `tj-${randomUUID()}`)
  for (const t of tenants) await seedAccount(t)
  const results = await Promise.all(
    tenants.map((t, i) =>
      runWithTenant(t, async () => {
        await new Promise((r) => setTimeout(r, (tenants.length - i) * 5))
        return ledgerDb.chartAccount.findMany()
      }),
    ),
  )
  results.forEach((rows, i) => assert.deepEqual(rows.map((r) => r.tenantId), [tenants[i]]))
})

test('strict: a tenant-owned model with no tenant bound throws; runUnscoped is the explicit way around it', async () => {
  setTenantScopeModeForTests('strict')
  await assert.rejects(ledgerDb.chartAccount.findMany(), TenantScopeError)
  const rows = await runUnscoped('test', () => ledgerDb.chartAccount.findMany({ take: 1 }))
  assert.ok(Array.isArray(rows))
  await assert.rejects(runUnscoped('  ', () => 1), /reason/)
  // Models without a tenantId column are not blocked.
  await runWithTenant('x', () => orderDb.orderLineItem.count())
})

test('audit (the default) changes nothing but records each unscoped site', async () => {
  setTenantScopeModeForTests('audit')
  const { a, b } = ids()
  const rowB = await seedAccount(b)
  resetTenantScopeReport()

  // No tenant: still returns data, but is reported.
  assert.ok(await ledgerDb.chartAccount.findUnique({ where: { id: rowB.id } }))
  // Tenant A reading B's row by bare id: returns it (audit does not rewrite) and is reported.
  assert.ok(await runWithTenant(a, () => ledgerDb.chartAccount.findUnique({ where: { id: rowB.id } })))

  const report = tenantScopeReport()
  const kinds = report.violations.map((v) => v.kind).sort()
  assert.deepEqual(kinds, ['missing-filter', 'no-tenant-context'])
  assert.ok(report.violations.every((v) => v.client === 'ledger' && v.model === 'ChartAccount' && v.operation === 'findUnique'))
})

test('off: no checks at all', async () => {
  setTenantScopeModeForTests('off')
  await ledgerDb.chartAccount.findMany({ take: 1 })
  assert.equal(tenantScopeReport().total, 0)
})

test('a request binds to one tenant and its queries are scoped from then on', async () => {
  setTenantScopeModeForTests('enforce')
  const { a, b } = ids()
  await seedAccount(a)
  await seedAccount(b)
  const rows = await runInRequestScope(async () => {
    bindRequestTenant(a)
    await new Promise((r) => setTimeout(r, 5))
    return ledgerDb.chartAccount.findMany()
  })
  assert.deepEqual(rows.map((r) => r.tenantId), [a])
  assert.throws(() => runInRequestScope(() => { bindRequestTenant(a); bindRequestTenant(b) }), /different tenant/)
})

// ---------------------------------------------------------------- structural guarantees

const prismaDir = path.resolve(import.meta.dirname, '../../prisma')

function modelsWithoutTenantId(): string[] {
  const out: string[] = []
  for (const dir of readdirSync(prismaDir)) {
    const file = path.join(prismaDir, dir, 'schema.prisma')
    if (!existsSync(file)) continue
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      if (!/^\s+tenantId\s/m.test(m[2])) out.push(`${dir === 'saleschannels' ? 'saleschannels' : dir}.${m[1]}`)
    }
  }
  return out.sort()
}

test('every model without a tenantId column is on the documented exempt list, and the list has no stale entries', () => {
  const actual = modelsWithoutTenantId()
  const listed = Object.keys(TENANT_EXEMPT_MODELS).sort()
  const undeclared = actual.filter((m) => !listed.includes(m))
  const stale = listed.filter((m) => !actual.includes(m))
  assert.deepEqual(undeclared, [], `Add a tenantId column, or list the model in tenant-scope-models.ts with a reason: ${undeclared.join(', ')}`)
  assert.deepEqual(stale, [], `Remove from tenant-scope-models.ts: ${stale.join(', ')}`)
  for (const [k, v] of Object.entries(TENANT_EXEMPT_MODELS)) assert.ok(v.note.length > 8, `${k} needs a real note`)
})

test('every client exported from db.ts is wrapped in the tenant scope', () => {
  const src = readFileSync(path.resolve(import.meta.dirname, 'db.ts'), 'utf8')
  const exports = [...src.matchAll(/^export const (\w+Db) =.*$/gm)]
  assert.equal(exports.length, 16)
  for (const m of exports) assert.match(m[0], /withTenantScope\(/, `${m[1]} is not tenant-scoped`)
})

test('the count of unguarded unique-key sites can only go down', () => {
  const script = path.resolve(import.meta.dirname, '../../../../scripts/scan-tenant-sites.mjs')
  const out = JSON.parse(execFileSync(process.execPath, [script, '--json'], { encoding: 'utf8' })) as { unguarded: number }
  assert.ok(out.unguarded <= 21, `unguarded sites rose to ${out.unguarded}; scope the new query by tenantId (see docs/TENANT_SCOPE.md)`)
})
