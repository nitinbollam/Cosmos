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
