import test from 'node:test'
import assert from 'node:assert/strict'
import {
  caseVariants,
  goodsCost,
  parseOrderNumberRef,
  parsePoRef,
  parseQuoteRef,
  productSearchTokens,
  resolveDateRange,
  sumByCurrency,
} from './erp-query-contracts'

const NOW = new Date('2026-10-14T15:30:00Z') // a Wednesday

test('resolveDateRange: calendar months are half-open UTC ranges', () => {
  const last = resolveDateRange('orders from last month', NOW)!
  assert.equal(last.from.toISOString(), '2026-09-01T00:00:00.000Z')
  assert.equal(last.to.toISOString(), '2026-10-01T00:00:00.000Z')
  const thisMonth = resolveDateRange('this month', NOW)!
  assert.equal(thisMonth.from.toISOString(), '2026-10-01T00:00:00.000Z')
  assert.equal(thisMonth.to.toISOString(), '2026-11-01T00:00:00.000Z')
})

test('resolveDateRange: January "last month" crosses the year', () => {
  const r = resolveDateRange('last month', new Date('2026-01-10T00:00:00Z'))!
  assert.equal(r.from.toISOString(), '2025-12-01T00:00:00.000Z')
  assert.equal(r.to.toISOString(), '2026-01-01T00:00:00.000Z')
})

test('resolveDateRange: weeks start Monday', () => {
  const r = resolveDateRange('last week', NOW)!
  assert.equal(r.from.toISOString(), '2026-10-05T00:00:00.000Z')
  assert.equal(r.to.toISOString(), '2026-10-12T00:00:00.000Z')
})

test('resolveDateRange: rolling days include today', () => {
  const r = resolveDateRange('in the past 7 days', NOW)!
  assert.equal(r.from.toISOString(), '2026-10-08T00:00:00.000Z')
  assert.equal(r.to.toISOString(), '2026-10-15T00:00:00.000Z')
})

test('resolveDateRange: no period named means no date filter', () => {
  assert.equal(resolveDateRange('show pending orders', NOW), undefined)
})

test('reference parsing', () => {
  assert.equal(parseOrderNumberRef('status of ORD-1001'), 1001)
  assert.equal(parseOrderNumberRef('order #1042 please'), 1042)
  assert.equal(parseOrderNumberRef('show orders'), undefined)
  assert.equal(parsePoRef('lines on PO#77'), 'PO-77')
  assert.equal(parsePoRef('po-1001'), 'PO-1001')
  assert.equal(parseQuoteRef('quote Q-AB12CD34'), 'ab12cd34')
})

test('goodsCost: a missing unit cost makes the total unknown, not zero', () => {
  assert.deepEqual(goodsCost([{ qty: 2, unitCost: 5 }, { qty: 3, unitCost: 1.5 }]), { amount: 14.5, missingCostLines: 0 })
  assert.deepEqual(goodsCost([{ qty: 2, unitCost: 5 }, { qty: 3, unitCost: null }]), { amount: null, missingCostLines: 1 })
})

test('sumByCurrency never adds different currencies', () => {
  assert.deepEqual(
    sumByCurrency([
      { currency: 'USD', amount: 10 },
      { currency: 'usd', amount: 5.255 },
      { currency: 'EUR', amount: 7 },
    ]),
    { USD: 15.26, EUR: 7 },
  )
})

test('productSearchTokens strips lookup words and keeps quoted text', () => {
  assert.deepEqual(productSearchTokens('cable product'), ['cable'])
  assert.deepEqual(productSearchTokens('all products containing cable'), ['cable'])
  assert.deepEqual(productSearchTokens('stock for usb-c cable'), ['usb-c', 'cable'])
  assert.deepEqual(productSearchTokens('find "Cable A"'), ['Cable A'])
  assert.deepEqual(productSearchTokens('show products'), [])
})

test('caseVariants covers lower, upper and title case', () => {
  assert.deepEqual(caseVariants('cable'), ['cable', 'CABLE', 'Cable'])
})

test('quarter phrases resolve to UTC calendar quarters', async () => {
  const { quarterRange, quarterOf, shiftQuarter } = await import('./erp-query-contracts')
  const now = new Date('2026-10-27T12:00:00Z')
  assert.equal(resolveDateRange('sales this quarter', now)?.from.toISOString(), '2026-10-01T00:00:00.000Z')
  const last = resolveDateRange('last quarter', now)!
  assert.deepEqual([last.from.toISOString(), last.to.toISOString(), last.label], ['2026-07-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'Q3 2026'])
  assert.equal(resolveDateRange('next quarter', now)?.label, 'Q1 2027')
  assert.equal(resolveDateRange('revenue in q2', now)?.label, 'Q2 2026')
  assert.equal(resolveDateRange('q1 2025 revenue', now)?.label, 'Q1 2025')
  assert.deepEqual(shiftQuarter(quarterOf(now), 1), { year: 2027, q: 1 })
  assert.equal(quarterRange({ year: 2026, q: 4 }).to.toISOString(), '2027-01-01T00:00:00.000Z')
})

test('forecastFromQuarters refuses without 3 full quarters since the first sale', async () => {
  const { forecastFromQuarters } = await import('./erp-query-contracts')
  const q = (label: string, from: string, to: string, revenue: number, orders: number) => ({ label, from: new Date(from), to: new Date(to), revenue, orders })
  const quarters = [
    q('Q1 2026', '2026-01-01Z', '2026-04-01Z', 0, 0),
    q('Q2 2026', '2026-04-01Z', '2026-07-01Z', 0, 0),
    q('Q3 2026', '2026-07-01Z', '2026-10-01Z', 0, 0),
  ]
  const young = forecastFromQuarters(quarters, new Date('2026-10-01T10:00:00Z'))
  assert.equal(young.estimate, null)
  assert.match((young as { reason: string }).reason, /start in Q4 2026 \(0 full quarters/)
  assert.equal(forecastFromQuarters(quarters, null).estimate, null)

  const grown = forecastFromQuarters(
    [q('Q1 2026', '2026-01-01Z', '2026-04-01Z', 900, 9), q('Q2 2026', '2026-04-01Z', '2026-07-01Z', 1200, 12), q('Q3 2026', '2026-07-01Z', '2026-10-01Z', 1500, 15)],
    new Date('2025-12-15T00:00:00Z'),
  )
  assert.deepEqual(grown.estimate, { revenue: 1200, orders: 12 })
})

test('answerLimit reads single answers, top N and explicit "not the list"', async () => {
  const { answerLimit } = await import('./erp-query-contracts')
  assert.equal(answerLimit('which product has the most sales'), 1)
  assert.equal(answerLimit('tell the most, not the list'), 1)
  assert.equal(answerLimit('just the top one please'), 1)
  assert.equal(answerLimit('show the top 3 sellers'), 3)
  assert.equal(answerLimit('top 50 products'), 10)
  assert.equal(answerLimit('best selling products'), undefined)
  assert.equal(answerLimit('show stock levels'), undefined)
})

test('singularWord lets plural searches find singular product names', async () => {
  const { singularWord, productSearchTokens } = await import('./erp-query-contracts')
  assert.equal(singularWord('drinks'), 'drink')
  assert.equal(singularWord('pens'), 'pen')
  assert.equal(singularWord('boxes'), 'box')
  assert.equal(singularWord('batteries'), 'battery')
  assert.equal(singularWord('glass'), 'glass')
  assert.equal(singularWord('USB'), 'USB')
  assert.deepEqual(productSearchTokens('do we have energy drinks in stock?'), ['energy', 'drinks'])
})
