import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import { tenantDb } from './db'
import { ApiError } from './session'
import {
  assertValidSalesTaxRate,
  classifyTaxSettings,
  getTenantSalesTaxRate,
  getTenantTaxSettings,
  updateTenantSalesTaxRate,
} from './tenant-tax'
import { backfillTenantSalesTax } from './tenant-tax-backfill'

test('classifyTaxSettings never invents a rate', () => {
  assert.deepEqual(classifyTaxSettings(undefined), { status: 'missing', rate: null, confirmedAt: null })
  assert.deepEqual(classifyTaxSettings({}), { status: 'missing', rate: null, confirmedAt: null })
  assert.equal(classifyTaxSettings({ salesTaxRate: 7 }).status, 'invalid')
  assert.equal(classifyTaxSettings({ salesTaxRate: '0.07' }).status, 'invalid')
  assert.equal(classifyTaxSettings({ salesTaxRate: -0.1 }).status, 'invalid')
  assert.equal(classifyTaxSettings({ salesTaxRate: 0.07 }).status, 'unconfirmed')
  const ok = classifyTaxSettings({ salesTaxRate: 0, salesTaxConfirmedAt: '2026-10-01T00:00:00.000Z' })
  assert.equal(ok.status, 'configured')
  assert.equal(ok.rate, 0)
})

test('assertValidSalesTaxRate rejects 7 (percent typed as a rate) with guidance, accepts 0.07 and explicit 0', () => {
  assert.throws(
    () => assertValidSalesTaxRate(7),
    (e: unknown) => e instanceof ApiError && e.status === 400 && /0\.07/.test(e.message),
  )
  assert.throws(() => assertValidSalesTaxRate('0.07'), (e: unknown) => e instanceof ApiError && e.status === 400)
  assert.throws(() => assertValidSalesTaxRate(Number.NaN), (e: unknown) => e instanceof ApiError && e.status === 400)
  assert.equal(assertValidSalesTaxRate(0.07), 0.07)
  assert.equal(assertValidSalesTaxRate(0), 0)
})

const ids: string[] = []
const mkOrg = async (settings: Record<string, unknown>) => {
  const id = `t-${randomUUID()}`
  ids.push(id)
  await tenantDb.tenantOrganization.create({
    data: { id, slug: `tax-${id.slice(-8)}`, displayName: "Tax Co", settings: settings as never, metadata: {} },
  })
  return id
}
before(() => undefined)
after(async () => {
  await tenantDb.tenantOrganization.deleteMany({ where: { id: { in: ids } } })
})

test('a tenant with no stored rate cannot be priced: 422, not 7%', async () => {
  const t = await mkOrg({})
  await assert.rejects(
    () => getTenantSalesTaxRate(t),
    (e: unknown) => e instanceof ApiError && e.status === 422 && /not configured/i.test(e.message),
  )
  const s = await getTenantTaxSettings(t)
  assert.equal(s.status, 'missing')
  assert.equal(s.salesTaxRate, null)
})

test('a stored invalid value reports invalid, not 7%', async () => {
  const t = await mkOrg({ salesTaxRate: 7 })
  assert.equal((await getTenantTaxSettings(t)).status, 'invalid')
  await assert.rejects(() => getTenantSalesTaxRate(t))
})

test('saving a rate confirms it; explicit 0 is honoured', async () => {
  const t = await mkOrg({})
  const s = await updateTenantSalesTaxRate(t, 0)
  assert.equal(s.status, 'configured')
  assert.equal(s.salesTaxRate, 0)
  assert.equal(await getTenantSalesTaxRate(t), 0)
  await assert.rejects(() => updateTenantSalesTaxRate(t, 7), (e: unknown) => e instanceof ApiError && e.status === 400)
})

test('backfill makes the legacy rate explicit but unconfirmed, is a no-op in dry run, and is idempotent', async () => {
  const missing = await mkOrg({})
  const invalid = await mkOrg({ salesTaxRate: 7 })
  const confirmed = await mkOrg({ salesTaxRate: 0.0825, salesTaxConfirmedAt: '2026-09-01T00:00:00.000Z' })

  const dry = await backfillTenantSalesTax({ dryRun: true })
  assert.ok(dry.some((r) => r.tenantId === missing && !r.applied))
  assert.equal((await getTenantTaxSettings(missing)).status, 'missing')

  await backfillTenantSalesTax({ dryRun: false })
  const m = await getTenantTaxSettings(missing)
  assert.equal(m.status, 'unconfirmed')
  assert.equal(m.salesTaxRate, 0.07)
  assert.equal((await getTenantTaxSettings(invalid)).status, 'unconfirmed')
  const c = await getTenantTaxSettings(confirmed)
  assert.equal(c.status, 'configured')
  assert.equal(c.salesTaxRate, 0.0825)

  const again = await backfillTenantSalesTax({ dryRun: false })
  assert.ok(!again.some((r) => ids.includes(r.tenantId)))
})
