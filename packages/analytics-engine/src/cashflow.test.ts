import assert from 'node:assert/strict'
import test from 'node:test'
import { forecastCashFlow } from './cashflow'

test('forecastCashFlow returns EWMA buckets', () => {
  const res = forecastCashFlow({
    tenant_id: 't1',
    history: [
      { period: '2026-01-01', inflow: 1000, outflow: 500 },
      { period: '2026-01-08', inflow: 1100, outflow: 520 },
      { period: '2026-01-15', inflow: 1050, outflow: 510 },
      { period: '2026-01-22', inflow: 1200, outflow: 540 },
    ],
    horizon_weeks: 4,
  })

  assert.equal(res.tenant_id, 't1')
  assert.equal(res.forecast.length, 4)
  assert.ok(res.weekly_net_baseline > 0)
  assert.match(res.method, /net_ewma/)
})
