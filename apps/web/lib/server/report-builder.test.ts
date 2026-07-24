import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agingBucket,
  csvEscape,
  isReportType,
  normalizeFilters,
  reportCatalog,
  rowsToCsv,
} from './report-builder'

test('isReportType accepts known types', () => {
  assert.equal(isReportType('ORDERS'), true)
  assert.equal(isReportType('INVENTORY'), true)
  assert.equal(isReportType('AR_AGING'), true)
  assert.equal(isReportType('MSA'), false)
})

test('reportCatalog covers orders, inventory, AR aging', () => {
  const types = reportCatalog().map((c) => c.type)
  assert.deepEqual(types, ['ORDERS', 'INVENTORY', 'AR_AGING'])
})

test('normalizeFilters trims strings and coerces booleans', () => {
  const f = normalizeFilters({
    status: ' PENDING ',
    from: '2026-01-01',
    inStockOnly: 'true',
    openOnly: 'false',
    junk: 1,
  })
  assert.equal(f.status, 'PENDING')
  assert.equal(f.fromIso, '2026-01-01')
  assert.equal(f.inStockOnly, true)
  assert.equal(f.openOnly, false)
})

test('agingBucket matches finance buckets', () => {
  assert.equal(agingBucket(0), '0-30')
  assert.equal(agingBucket(30), '0-30')
  assert.equal(agingBucket(31), '31-60')
  assert.equal(agingBucket(90), '61-90')
  assert.equal(agingBucket(91), '91-120')
  assert.equal(agingBucket(121), '120+')
})

test('csvEscape quotes commas and quotes', () => {
  assert.equal(csvEscape('plain'), 'plain')
  assert.equal(csvEscape('a,b'), '"a,b"')
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""')
  assert.equal(csvEscape(null), '')
})

test('rowsToCsv builds header and body', () => {
  const csv = rowsToCsv(
    [
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B, C' },
    ],
    [
      { a: 1, b: 'x' },
      { a: 2, b: 'y,z' },
    ],
  )
  assert.equal(csv, 'A,"B, C"\n1,x\n2,"y,z"')
})
