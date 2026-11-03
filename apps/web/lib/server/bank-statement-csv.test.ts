import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCsv, parseIsoDate, parseMoney, parseStatementCsv, validateStatementRows, withDedupeKeys } from './bank-statement-csv'

test('money is parsed from text into Decimal, strictly', () => {
  assert.equal(parseMoney('1,234.50')!.toFixed(2), '1234.50')
  assert.equal(parseMoney(-120)!.toFixed(2), '-120.00')
  assert.equal(parseMoney('0.1')!.plus(parseMoney('0.2')!).toString(), '0.3')
  for (const bad of ['abc', '1.234', '', ' ', '1e3', 'NaN', Number.NaN, Number.POSITIVE_INFINITY, 1e21, null, undefined, {}]) {
    assert.equal(parseMoney(bad), null, String(bad))
  }
})

test('dates must be real YYYY-MM-DD calendar dates', () => {
  assert.equal(parseIsoDate('2026-02-28')!.toISOString(), '2026-02-28T00:00:00.000Z')
  for (const bad of ['2026-02-30', '2026-13-01', '02/28/2026', '2026-2-3', '', 20260228]) {
    assert.equal(parseIsoDate(bad), null, String(bad))
  }
})

test('CSV parser handles quotes, embedded commas, doubled quotes and CRLF', () => {
  const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""",3\r\n\r\n4,5,6')
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x, y', 'say "hi"', '3'],
    ['4', '5', '6'],
  ])
  assert.throws(() => parseCsv('a\n"open'), { status: 400 })
})

test('malformed rows are reported per row and none are accepted', () => {
  const csv = [
    'Date,Description,Amount',
    '2026-09-03,ok,10.00',
    '2026-13-01,bad date,10.00',
    '2026-09-04,bad amount,abc',
    '2026-09-05,too precise,1.234',
    '2026-09-06,,5.00',
    '2026-10-01,outside period,5.00',
    '2026-09-07,zero,0',
  ].join('\n')
  const out = parseStatementCsv(csv, undefined, { periodStart: parseIsoDate('2026-09-01')!, periodEnd: parseIsoDate('2026-09-30')! })
  assert.equal(out.lines.length, 1)
  assert.deepEqual(
    out.errors.map((e) => e.row),
    [3, 4, 5, 6, 7, 8],
  )
  assert.match(out.errors.find((e) => e.row === 7)!.message, /outside the statement period/)
})

test('debit/credit columns map to signed amounts; both filled is rejected', () => {
  const out = parseStatementCsv('date,description,debit,credit\n2026-09-01,fee,15.00,\n2026-09-02,dep,,20\n2026-09-03,both,1,1')
  assert.deepEqual(
    out.lines.map((l) => l.amount.toFixed(2)),
    ['-15.00', '20.00'],
  )
  assert.deepEqual(
    out.errors.map((e) => e.row),
    [4],
  )
})

test('file hash ignores BOM and line-ending differences; mapping can name columns', () => {
  const a = parseStatementCsv('﻿when,what,value\r\n2026-09-01,x,1\r\n', { date: 'when', description: 'what', amount: 'value' })
  const b = parseStatementCsv('when,what,value\n2026-09-01,x,1', { date: 'when', description: 'what', amount: 'value' })
  assert.equal(a.fileSha256, b.fileSha256)
  assert.throws(() => parseStatementCsv('a,b\n1,2', { date: 'missing' }), { status: 400 })
})

test('dedupe keys: identical rows in one file stay distinct, and are stable across re-imports', () => {
  const rows = validateStatementRows([
    { row: 1, postedAt: '2026-09-15', description: 'Deposit', amount: '75.00' },
    { row: 2, postedAt: '2026-09-15', description: 'deposit ', amount: '75' },
  ]).lines
  const keys = withDedupeKeys('acct-1', rows).map((r) => r.dedupeKey)
  assert.notEqual(keys[0], keys[1])
  assert.deepEqual(withDedupeKeys('acct-1', rows).map((r) => r.dedupeKey), keys)
  assert.notDeepEqual(withDedupeKeys('acct-2', rows).map((r) => r.dedupeKey), keys)
})

test('row limit and empty input are rejected', () => {
  assert.throws(() => validateStatementRows([]), { status: 400 })
  const many = Array.from({ length: 5001 }, (_, i) => ({ row: i + 1, postedAt: '2026-09-01', description: 'x', amount: '1' }))
  assert.throws(() => validateStatementRows(many), { status: 400 })
})
