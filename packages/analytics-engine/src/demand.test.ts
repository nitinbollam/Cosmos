import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forecastDemandUsage } from './demand'

test('forecastDemandUsage returns STATIC_REORDER for empty history', () => {
  const r = forecastDemandUsage({ history: [], leadTimeDays: 7, safetyStock: 5 })
  assert.equal(r.method, 'STATIC_REORDER')
  assert.equal(r.ewmaDailyUsage, 0)
  assert.equal(r.suggestedCoverQty, 5)
  assert.ok(r.warnings.length > 0)
})

test('forecastDemandUsage EWMA reacts to recent spike', () => {
  const history = [
    ...Array.from({ length: 20 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, quantity: 2 })),
    ...Array.from({ length: 10 }, (_, i) => ({ date: `2026-01-${String(i + 21).padStart(2, '0')}`, quantity: 10 })),
  ]
  const r = forecastDemandUsage({ history, leadTimeDays: 7, safetyStock: 0 })
  assert.match(r.method, /USAGE_EWMA/)
  assert.ok(r.ewmaDailyUsage > r.avgDailyUsage * 0.9)
  assert.ok(r.suggestedCoverQty >= Math.ceil(r.ewmaDailyUsage * 7))
  assert.equal(r.forecastDaily.length, 7)
})

test('forecastDemandUsage applies seasonal method when enough history', () => {
  const history = Array.from({ length: 28 }, (_, i) => ({
    date: `2026-02-${String((i % 28) + 1).padStart(2, '0')}`,
    quantity: i % 7 === 0 ? 12 : 2,
  }))
  const r = forecastDemandUsage({
    history,
    leadTimeDays: 7,
    safetyStock: 3,
    seasonalPeriod: 7,
  })
  assert.match(r.method, /USAGE_EWMA/)
  assert.match(r.method, /SEASONAL/)
  assert.ok(r.suggestedCoverQty >= 3)
})
