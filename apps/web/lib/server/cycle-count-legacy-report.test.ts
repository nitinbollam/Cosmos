import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { classifyLegacyPostings, type CountFinding, type LegacyCount, type LegacyEntry, type LegacyLine } from './cycle-count-legacy'
import { inventoryDb, orderDb, wmsDb } from './db'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCRIPT = 'scripts/cycle-count-legacy-postings-report.ts'

// ---- Classification (pure) ----

const submittedAt = new Date('2026-01-10T10:00:00Z')
const count: LegacyCount = { id: 'c1', tenantId: 't1', warehouseId: 'w1', status: 'PENDING_APPROVAL', submittedAt }
const line = (id: string, skuId: string, systemQty: number, countedQty: number, postedLedgerId: string | null = null): LegacyLine => ({
  id, skuId, systemQty, countedQty, postedLedgerId,
})
const entry = (id: string, skuId: string, quantityDelta: number, over: Partial<LegacyEntry> = {}): LegacyEntry => ({
  id, tenantId: 't1', skuId, warehouseId: 'w1', batchId: '', quantityDelta, correlationId: 'corr-1',
  occurredAt: new Date('2026-01-11T10:00:00Z'), ...over,
})

test('no historical postings', () => {
  const f = classifyLegacyPostings(count, [line('l1', 's1', 10, 13)], [], 'c1')
  assert.equal(f.classification, 'NO_HISTORICAL_POSTINGS')
  assert.equal(f.unreviewed, 0)
})

test('one exact posting per line is potentially recoverable, with its single candidate line', () => {
  const f = classifyLegacyPostings(count, [line('l1', 's1', 10, 13), line('l2', 's2', 10, 6)], [entry('e1', 's1', 3), entry('e2', 's2', -4)], 'c1')
  assert.equal(f.classification, 'POTENTIALLY_RECOVERABLE')
  assert.deepEqual(f.entries.map((e) => e.candidateLineId), ['l1', 'l2'])
  assert.equal(f.attempts, 1)
})

test('more postings than lines for a SKU is a possible duplicate', () => {
  const f = classifyLegacyPostings(count, [line('l1', 's1', 10, 13)], [entry('e1', 's1', 3), entry('e2', 's1', 3, { correlationId: 'corr-2' })], 'c1')
  assert.equal(f.classification, 'POSSIBLE_DUPLICATE')
  assert.equal(f.attempts, 2)
  assert.ok(f.entries.every((e) => e.candidateLineId === null))
})

test('anything that could tie a posting to more than one place, or none, is ambiguous', () => {
  const cases: Array<[string, LegacyLine[], LegacyEntry[], LegacyCount | null]> = [
    ['other quantity', [line('l1', 's1', 10, 13)], [entry('e1', 's1', 5)], count],
    ['two lines for the SKU', [line('l1', 's1', 10, 13), line('l2', 's1', 0, 3)], [entry('e1', 's1', 3)], count],
    ['no line for the SKU', [line('l1', 's1', 10, 13)], [entry('e1', 's9', 3)], count],
    ['other warehouse', [line('l1', 's1', 10, 13)], [entry('e1', 's1', 3, { warehouseId: 'w2' })], count],
    ['batched', [line('l1', 's1', 10, 13)], [entry('e1', 's1', 3, { batchId: 'b1' })], count],
    ['other tenant', [line('l1', 's1', 10, 13)], [entry('e1', 's1', 3, { tenantId: 't2' })], count],
    ['before submission', [line('l1', 's1', 10, 13)], [entry('e1', 's1', 3, { occurredAt: new Date('2026-01-09T10:00:00Z') })], count],
    ['never submitted', [line('l1', 's1', 10, 13)], [entry('e1', 's1', 3)], { ...count, submittedAt: null }],
    ['count missing', [], [entry('e1', 's1', 3)], null],
  ]
  for (const [name, lines, entries, c] of cases) {
    const f = classifyLegacyPostings(c, lines, entries, 'c1')
    assert.equal(f.classification, 'AMBIGUOUS', name)
    assert.ok(f.entries.every((e) => e.candidateLineId === null), name)
    assert.ok(f.problems.length + f.entries.flatMap((e) => e.problems).length > 0, name)
  }
})

test('a posting a person recorded on its line is reviewed and no longer counts', () => {
  const f = classifyLegacyPostings(count, [line('l1', 's1', 10, 13, 'e1'), line('l2', 's2', 10, 6)], [entry('e1', 's1', 3)], 'c1')
  assert.equal(f.classification, 'NO_HISTORICAL_POSTINGS')
  assert.equal(f.unreviewed, 0)
  assert.equal(f.entries[0].recordedOnLineId, 'l1')
  // A second posting for the reviewed line's SKU is then a duplicate.
  const g = classifyLegacyPostings(count, [line('l1', 's1', 10, 13, 'e1')], [entry('e1', 's1', 3), entry('e2', 's1', 3)], 'c1')
  assert.equal(g.classification, 'POSSIBLE_DUPLICATE')
})

// ---- The report script, against the test databases ----

const tenantId = `t-${randomUUID()}`
const warehouseId = `w-${randomUUID()}`

after(async () => {
  await wmsDb.cycleCount.deleteMany({ where: { tenantId } })
  await inventoryDb.stockLedgerEntry.deleteMany({ where: { tenantId } })
})

async function seedCount(status: 'PENDING_APPROVAL' | 'COMPLETED', lines: Array<{ skuId: string; systemQty: number; countedQty: number }>) {
  return wmsDb.cycleCount.create({
    data: { tenantId, warehouseId, type: 'FULL', status, submittedAt: new Date(Date.now() - 60_000), createdBy: 'u', lines: { create: lines } },
    include: { lines: true },
  })
}

function seedEntry(countId: string, skuId: string, quantityDelta: number, over: { correlationId?: string; idempotencyKey?: string } = {}) {
  return inventoryDb.stockLedgerEntry.create({
    data: {
      id: randomUUID(), tenantId, skuId, warehouseId, batchId: '', eventType: 'STOCK_ADJUSTED', quantityDelta, quantityAfter: 0,
      unitCost: '1', referenceId: countId, referenceType: 'CYCLE_COUNT', performedBy: 'old', correlationId: over.correlationId ?? randomUUID(),
      idempotencyKey: over.idempotencyKey ?? null,
    },
  })
}

function runReport(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, CYCLE_COUNT_REPORT_ENV: 'local', ...env },
    encoding: 'utf8',
    timeout: 120_000,
  })
  return { status: res.status, stdout: res.stdout, stderr: res.stderr }
}

/** Everything the report could touch, for this tenant. */
async function snapshot() {
  return {
    ledger: await inventoryDb.stockLedgerEntry.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
    counts: await wmsDb.cycleCount.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, include: { lines: { orderBy: { id: 'asc' } } } }),
    stock: await inventoryDb.stockLevel.findMany({ where: { tenantId } }),
    jobs: await orderDb.postingJob.count({ where: { tenantId } }),
  }
}

test('the report classifies each count, lists its postings, and changes nothing', async () => {
  const recoverable = await seedCount('PENDING_APPROVAL', [{ skuId: 's-gain', systemQty: 10, countedQty: 13 }])
  const r1 = await seedEntry(recoverable.id, 's-gain', 3)
  const duplicated = await seedCount('PENDING_APPROVAL', [{ skuId: 's-gain', systemQty: 10, countedQty: 13 }])
  await seedEntry(duplicated.id, 's-gain', 3)
  await seedEntry(duplicated.id, 's-gain', 3)
  const mismatched = await seedCount('PENDING_APPROVAL', [{ skuId: 's-gain', systemQty: 10, countedQty: 13 }])
  await seedEntry(mismatched.id, 's-gain', 5)
  const completedTwice = await seedCount('COMPLETED', [{ skuId: 's-loss', systemQty: 10, countedQty: 6 }])
  await seedEntry(completedTwice.id, 's-loss', -4)
  await seedEntry(completedTwice.id, 's-loss', -4)
  const clean = await seedCount('PENDING_APPROVAL', [{ skuId: 's-gain', systemQty: 10, countedQty: 13 }])
  await seedEntry(clean.id, 's-gain', 3, { idempotencyKey: `cycle-count-line:${clean.lines[0].id}` }) // keyed: not legacy
  const orphanId = `missing-${randomUUID()}`
  await seedEntry(orphanId, 's-gain', 3)

  const before = await snapshot()
  const res = runReport(['--json', '--tenant', tenantId])
  assert.equal(res.status, 1, res.stderr)
  const report = JSON.parse(res.stdout) as { summary: Record<string, number>; pendingCountsWithoutHistoricalPostings: number; findings: CountFinding[] }
  const byCount = new Map(report.findings.map((f) => [f.countId, f]))

  assert.equal(byCount.get(recoverable.id)!.classification, 'POTENTIALLY_RECOVERABLE')
  assert.equal(byCount.get(recoverable.id)!.entries[0].candidateLineId, recoverable.lines[0].id)
  assert.equal(byCount.get(recoverable.id)!.entries[0].entryId, r1.id)
  assert.equal(byCount.get(recoverable.id)!.entries[0].correlationId, r1.correlationId)
  assert.equal(byCount.get(recoverable.id)!.entries[0].quantityDelta, 3)
  assert.equal(byCount.get(recoverable.id)!.entries[0].warehouseId, warehouseId)
  assert.equal(byCount.get(duplicated.id)!.classification, 'POSSIBLE_DUPLICATE')
  assert.equal(byCount.get(duplicated.id)!.attempts, 2)
  assert.equal(byCount.get(mismatched.id)!.classification, 'AMBIGUOUS')
  assert.equal(byCount.get(completedTwice.id)!.classification, 'POSSIBLE_DUPLICATE')
  assert.equal(byCount.get(completedTwice.id)!.status, 'COMPLETED')
  assert.equal(byCount.get(orphanId)!.classification, 'AMBIGUOUS')
  assert.equal(byCount.has(clean.id), false, 'keyed postings are not legacy')
  assert.deepEqual(report.summary, { NO_HISTORICAL_POSTINGS: 0, POTENTIALLY_RECOVERABLE: 1, AMBIGUOUS: 2, POSSIBLE_DUPLICATE: 2 })
  assert.equal(report.pendingCountsWithoutHistoricalPostings, 1)

  // Read-only: stock, ledger, cycle counts, lines and GL jobs are exactly as they were.
  assert.deepEqual(await snapshot(), before)

  const text = runReport(['--tenant', tenantId])
  assert.equal(text.status, 1)
  assert.match(text.stdout, /\[POSSIBLE_DUPLICATE\] count /)
  assert.match(text.stdout, new RegExp(`entry ${r1.id}  sku s-gain  warehouse ${warehouseId}  delta 3  at .*  correlation ${r1.correlationId}`))
  assert.match(text.stdout, /need a review before approval/)
  assert.deepEqual(await snapshot(), before)
})

test('the report refuses production signals and an undeclared target without reading anything', () => {
  const prod = runReport(['--json'], { PLEROS_ENV: 'production' })
  assert.equal(prod.status, 2)
  assert.match(prod.stderr, /REFUSED: .*production.*Nothing was read/)
  const unapproved = runReport(['--json'], { CYCLE_COUNT_REPORT_ENV: 'production' })
  assert.equal(unapproved.status, 2)
  assert.match(unapproved.stderr, /--production-approval/)
  const undeclared = runReport(['--json'], { CYCLE_COUNT_REPORT_ENV: '' })
  assert.equal(undeclared.status, 2)
  assert.equal(prod.stdout + unapproved.stdout + undeclared.stdout, '')
})
