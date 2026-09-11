import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRevenueSeries, clampAnalyticsDays, startOfUtcDay } from './marketplace-analytics'

test('clampAnalyticsDays defaults to 30 and accepts allowed values', () => {
  assert.equal(clampAnalyticsDays(undefined), 30)
  assert.equal(clampAnalyticsDays(7), 7)
  assert.equal(clampAnalyticsDays(90), 90)
  assert.equal(clampAnalyticsDays(999), 30)
})

test('startOfUtcDay returns YYYY-MM-DD', () => {
  assert.equal(startOfUtcDay(new Date('2026-03-15T18:30:00.000Z')), '2026-03-15')
})

test('buildRevenueSeries buckets completed orders by day', () => {
  const today = new Date()
  today.setUTCHours(12, 0, 0, 0)

  const series = buildRevenueSeries(
    [
      {
        createdAt: today,
        agreedPriceCents: 10_000,
        listingType: 'FIXED',
        orderStatus: 'COMPLETED',
      },
      {
        createdAt: new Date(today.getTime() + 3_600_000),
        agreedPriceCents: 5_000,
        listingType: 'AUCTION',
        orderStatus: 'COMPLETED',
      },
      {
        createdAt: new Date(today.getTime() + 7_200_000),
        agreedPriceCents: 99_999,
        listingType: 'FIXED',
        orderStatus: 'PENDING_PAYMENT',
      },
    ],
    7,
  )

  assert.equal(series.length, 7)
  const bucket = series.find((row) => row.date === startOfUtcDay(today))
  assert.ok(bucket)
  assert.equal(bucket.orders, 2)
  assert.equal(bucket.grossCents, 15_000)
  assert.equal(bucket.netCents, 13_500)
})
