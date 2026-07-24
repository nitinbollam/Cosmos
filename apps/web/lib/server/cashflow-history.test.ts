import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyWeeklyBuckets, weekStartUtc } from './cashflow-history'

test('weekStartUtc returns Monday for mid-week date', () => {
  // 2026-07-17 is a Friday
  assert.equal(weekStartUtc(new Date('2026-07-17T15:00:00.000Z')), '2026-07-13')
})

test('weekStartUtc Sunday rolls back to prior Monday', () => {
  assert.equal(weekStartUtc(new Date('2026-07-12T12:00:00.000Z')), '2026-07-06')
})

test('emptyWeeklyBuckets creates contiguous weeks', () => {
  const map = emptyWeeklyBuckets(4, new Date('2026-07-17T00:00:00.000Z'))
  const keys = [...map.keys()]
  assert.equal(keys.length, 4)
  assert.equal(keys[keys.length - 1], '2026-07-13')
  assert.equal(keys[0], '2026-06-22')
})
