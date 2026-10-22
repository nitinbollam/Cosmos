import assert from 'node:assert/strict'
import test from 'node:test'
import { dayRange, parseBusinessDate, stockVariance } from './driver-day-rules'

test('short and over are counted apart, per item, across several counts', () => {
  const v = stockVariance([
    { skuId: 'a', expected: 10, counted: 8 },
    { skuId: 'b', expected: 5, counted: 7 },
    { skuId: 'c', expected: 3, counted: 3 },
    { skuId: 'a', expected: 4, counted: 4 },
  ])
  assert.deepEqual([v.unitsExpected, v.unitsCounted, v.unitsShort, v.unitsOver], [22, 22, 2, 2])
  assert.deepEqual(v.lines, [
    { skuId: 'a', expected: 14, counted: 12, difference: -2 },
    { skuId: 'b', expected: 5, counted: 7, difference: 2 },
  ])
  assert.deepEqual(stockVariance([]), { unitsExpected: 0, unitsCounted: 0, unitsShort: 0, unitsOver: 0, lines: [] })
})

test('business dates must be real calendar dates', () => {
  assert.deepEqual(parseBusinessDate('2026-10-22'), { year: 2026, month: 10, day: 22 })
  for (const bad of ['2026-02-30', '2026-13-01', '22-10-2026', '', null, 5, '2026-1-1']) assert.equal(parseBusinessDate(bad), null, String(bad))
})

test('a day is midnight to midnight in the tenant\'s zone, not UTC', () => {
  const r = dayRange('2026-10-22', 'America/New_York')!
  assert.equal(r.start.toISOString(), '2026-10-22T04:00:00.000Z') // EDT
  assert.equal(r.endExclusive.toISOString(), '2026-10-23T04:00:00.000Z')
  // 9pm Tampa on the 22nd is the 23rd in UTC but still inside the 22nd here.
  const evening = new Date('2026-10-23T01:00:00Z').getTime()
  assert.ok(evening >= r.start.getTime() && evening < r.endExclusive.getTime())
  assert.equal(dayRange('2026-10-22', null)!.start.toISOString(), '2026-10-22T00:00:00.000Z')
  assert.equal(dayRange('2026-10-22', 'Not/AZone')!.start.toISOString(), '2026-10-22T00:00:00.000Z')
  assert.equal(dayRange('nope', 'America/New_York'), null)
  // The clocks go back on 2026-11-01: that day is 25 hours long.
  const fall = dayRange('2026-11-01', 'America/New_York')!
  assert.equal((fall.endExclusive.getTime() - fall.start.getTime()) / 3_600_000, 25)
})
