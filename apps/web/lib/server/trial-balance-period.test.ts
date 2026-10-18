import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { ledgerDb, tenantDb } from './db'
import { createChartAccount, createJournalDraft, postJournalEntry, trialBalance } from './ledger'
import { periodRange, zonedMidnight } from './period-bounds'

const ZONES = ['Etc/UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland', 'America/Sao_Paulo', 'Europe/London']

test('zonedMidnight lands on local midnight in the tenant zone', () => {
  assert.equal(zonedMidnight(2026, 3, 1, 'America/New_York').toISOString(), '2026-04-01T04:00:00.000Z') // EDT
  assert.equal(zonedMidnight(2026, 0, 1, 'America/New_York').toISOString(), '2026-01-01T05:00:00.000Z') // EST
  assert.equal(zonedMidnight(2026, 0, 1, 'Asia/Kolkata').toISOString(), '2025-12-31T18:30:00.000Z')
  assert.equal(zonedMidnight(2026, 5, 1, 'Etc/UTC').toISOString(), '2026-06-01T00:00:00.000Z')
})

test('monthly periods are contiguous with no gap or overlap, including across DST, in every zone', () => {
  for (const tz of ZONES) {
    for (const year of [2025, 2026, 2027]) {
      const months = Array.from({ length: 12 }, (_, i) => periodRange(tz, year, 'MONTHLY', { month: i + 1 }))
      for (let i = 0; i < 11; i++) {
        assert.equal(months[i].endExclusive.getTime(), months[i + 1].start.getTime(), `${tz} ${year} month ${i + 1}`)
      }
      const whole = periodRange(tz, year, 'YEARLY')
      assert.equal(months[0].start.getTime(), whole.start.getTime())
      assert.equal(months[11].endExclusive.getTime(), whole.endExclusive.getTime())
      const q = [1, 2, 3, 4].map((n) => periodRange(tz, year, 'QUARTERLY', { quarter: n }))
      assert.equal(q[0].start.getTime(), whole.start.getTime())
      assert.equal(q[3].endExclusive.getTime(), whole.endExclusive.getTime())
      assert.equal(q[1].start.getTime(), months[3].start.getTime())
    }
  }
})

test('an invalid tenant zone falls back to UTC instead of using the server zone', () => {
  const r = periodRange('Not/AZone', 2026, 'MONTHLY', { month: 4 })
  assert.equal(r.start.toISOString(), '2026-04-01T00:00:00.000Z')
})

test('results do not depend on the process time zone', async () => {
  const { execFileSync } = await import('node:child_process')
  const script =
    "import('./lib/server/period-bounds.ts').then(m=>{const f=m.periodRange||m.default.periodRange;console.log(f('America/New_York',2026,'MONTHLY',{month:4}).start.toISOString())})"
  const outs = ['UTC', 'America/New_York', 'Asia/Kolkata'].map((TZ) =>
    execFileSync(process.execPath, ['--import', 'tsx', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }).trim(),
  )
  assert.deepEqual(outs, ['2026-04-01T04:00:00.000Z', '2026-04-01T04:00:00.000Z', '2026-04-01T04:00:00.000Z'])
})

async function mkTenant(timeZone: string) {
  const tenantId = `tb-${randomUUID()}`
  await tenantDb.tenantOrganization.create({
    data: { id: tenantId, slug: `tb-${tenantId.slice(-8)}`, displayName: 'TB Co', settings: {}, metadata: {}, timeZone },
  })
  const cash = await createChartAccount(tenantId, { code: '1000', name: 'Cash', type: 'ASSET' })
  const rev = await createChartAccount(tenantId, { code: '4000', name: 'Revenue', type: 'REVENUE' })
  return { tenantId, cash, rev }
}
const post = (tenantId: string, cashId: string, revId: string, amount: number, postedAt: string) =>
  ledgerDb.journalEntry.create({
    data: {
      tenantId,
      description: 'sale',
      isPosted: true,
      postedAt: new Date(postedAt),
      lines: { create: [{ accountId: cashId, debit: amount, credit: 0 }, { accountId: revId, debit: 0, credit: amount }] },
    },
  })

test('America/New_York tenant: 02:30Z on 1 Apr is still March, 04:30Z is April', async () => {
  const { tenantId, cash, rev } = await mkTenant('America/New_York')
  await post(tenantId, cash.id, rev.id, 10, '2026-04-01T02:30:00Z')
  await post(tenantId, cash.id, rev.id, 20, '2026-04-01T04:30:00Z')
  const march = await trialBalance(tenantId, 2026, { year: 2026, periodType: 'MONTHLY', month: 3 })
  const april = await trialBalance(tenantId, 2026, { year: 2026, periodType: 'MONTHLY', month: 4 })
  assert.equal(march.find((r) => r.accountCode === '1000')?.debitsExact, '10.00')
  assert.equal(april.find((r) => r.accountCode === '1000')?.debitsExact, '20.00')
})

test('an entry exactly on a period boundary lands in exactly one period', async () => {
  const { tenantId, cash, rev } = await mkTenant('America/New_York')
  await post(tenantId, cash.id, rev.id, 5, '2026-04-01T04:00:00Z') // local midnight, 1 Apr
  const counts = await Promise.all(
    [3, 4].map(async (m) => (await trialBalance(tenantId, 2026, { year: 2026, periodType: 'MONTHLY', month: m })).length),
  )
  assert.deepEqual(counts, [0, 2])
})

test('a bare year returns the whole year, not January', async () => {
  const { tenantId, cash, rev } = await mkTenant('Etc/UTC')
  await post(tenantId, cash.id, rev.id, 1, '2026-02-10T12:00:00Z')
  await post(tenantId, cash.id, rev.id, 2, '2026-09-10T12:00:00Z')
  const rows = await trialBalance(tenantId, 2026)
  assert.equal(rows.find((r) => r.accountCode === '1000')?.debitsExact, '3.00')
})

test('totals are exact decimals and equal an independent database SUM', async () => {
  const { tenantId, cash, rev } = await mkTenant('Etc/UTC')
  for (let i = 0; i < 300; i++) await post(tenantId, cash.id, rev.id, 0.1, '2026-05-05T12:00:00Z')
  const rows = await trialBalance(tenantId, 2026, { year: 2026, periodType: 'MONTHLY', month: 5 })
  const db = await ledgerDb.journalLine.aggregate({ where: { accountId: cash.id }, _sum: { debit: true } })
  const row = rows.find((r) => r.accountCode === '1000')!
  assert.equal(row.debitsExact, '30.00') // float addition of 300 x 0.1 would give 30.000000000000007
  assert.equal(row.debitsExact, db._sum.debit!.toFixed(2))
  assert.equal(row.netBalanceExact, '30.00')
})

test('a journal entry of 0.1, 0.2 and 0.3 balances and is stored without noise', async () => {
  const { tenantId, cash, rev } = await mkTenant('Etc/UTC')
  const entry = await createJournalDraft(tenantId, {
    description: 'tiny',
    lines: [
      { accountId: cash.id, debit: 0.1, credit: 0 },
      { accountId: cash.id, debit: 0.2, credit: 0 },
      { accountId: rev.id, debit: 0, credit: 0.3 },
    ],
  })
  await postJournalEntry(tenantId, entry.id)
  const lines = await ledgerDb.journalLine.findMany({ where: { entryId: entry.id }, orderBy: { id: 'asc' } })
  assert.deepEqual(lines.map((l) => l.debit.toString()).sort(), ['0', '0.1', '0.2'])
  assert.equal(lines.find((l) => l.credit.gt(0))?.credit.toString(), '0.3')
})

test('each period balances: total debits equal total credits across accounts', async () => {
  const { tenantId, cash, rev } = await mkTenant('Asia/Kolkata')
  await post(tenantId, cash.id, rev.id, 12.34, '2026-06-15T05:00:00Z')
  await post(tenantId, cash.id, rev.id, 0.66, '2026-06-30T19:00:00Z') // 1 Jul 00:30 in Kolkata
  const june = await trialBalance(tenantId, 2026, { year: 2026, periodType: 'MONTHLY', month: 6 })
  const sum = (k: 'debitsExact' | 'creditsExact') => june.reduce((s, r) => s + Math.round(Number(r[k]) * 100), 0)
  assert.equal(sum('debitsExact'), sum('creditsExact'))
  assert.equal(june.find((r) => r.accountCode === '1000')?.debitsExact, '12.34') // 0.66 is July locally
})
