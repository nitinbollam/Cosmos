import test from 'node:test'
import assert from 'node:assert/strict'
import type { ToolResult } from './tools'
import { buildResultSets, intentForFollowUp, liveResultSets, resolveFollowUp, RESULT_SET_TTL_MS } from './result-sets'

const SCOPE = { tenantId: 't1', userId: 'u1', role: 'MANAGER' }
const NOW = new Date('2026-10-19T12:00:00Z')

function orderRows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `ord_${i + 1}`, orderNumber: 1000 + i + 1 }))
}

const ordersResult: ToolResult = {
  name: 'orders.list',
  data: { rows: orderRows(8), total: 20, page: 1, pageSize: 8 },
  links: [],
}

function setsFrom(results: ToolResult[], params = {}) {
  return buildResultSets(results, params, SCOPE, NOW)
}

test('buildResultSets keeps refs and query context for list tools only', () => {
  const sets = setsFrom(
    [ordersResult, { name: 'finance.bills', data: { rows: [{ id: 'b1' }], total: 1 }, links: [] }],
    { orderStatus: 'BACKORDERED', dateRange: { from: new Date('2026-09-01Z'), to: new Date('2026-10-01Z'), label: 'last month' } },
  )
  assert.equal(sets.length, 1)
  assert.equal(sets[0].refs[1].label, 'ORD-1002')
  assert.equal(sets[0].params.dateRange?.from, '2026-09-01T00:00:00.000Z')
})

test('"open the second order" selects the second displayed row for a fresh read', () => {
  const sets = setsFrom([ordersResult])
  const f = resolveFollowUp('open the second order', sets)!
  assert.equal(f.type, 'select')
  assert.deepEqual(intentForFollowUp(f), { tools: ['orders.detail'], orderId: 'ord_2' })
})

test('"the last one" and "#3" resolve positions', () => {
  const sets = setsFrom([ordersResult])
  assert.deepEqual(intentForFollowUp(resolveFollowUp('show me the last one', sets)!), { tools: ['orders.detail'], orderId: 'ord_8' })
  assert.deepEqual(intentForFollowUp(resolveFollowUp('open #3', sets)!), { tools: ['orders.detail'], orderId: 'ord_3' })
})

test('an ordinal past the end asks instead of guessing', () => {
  const r = intentForFollowUp(resolveFollowUp('open the tenth order', setsFrom([ordersResult]))!)
  assert.ok('clarify' in r)
})

test('"show more" re-runs the same query on the next page with the same filters', () => {
  const sets = setsFrom([ordersResult], {
    orderStatus: 'BACKORDERED',
    sort: 'asc',
    dateRange: { from: new Date('2026-09-01Z'), to: new Date('2026-10-01Z'), label: 'last month' },
  })
  const r = intentForFollowUp(resolveFollowUp('show more', sets)!)
  assert.ok(!('clarify' in r))
  assert.deepEqual(r.tools, ['orders.list'])
  assert.equal(r.page, 2)
  assert.equal(r.orderStatus, 'BACKORDERED')
  assert.equal(r.sort, 'asc')
  assert.ok(r.dateRange?.from instanceof Date)
})

test('"show more" on a complete list says so', () => {
  const sets = setsFrom([{ ...ordersResult, data: { rows: orderRows(3), total: 3, page: 1, pageSize: 8 } }])
  const r = intentForFollowUp(resolveFollowUp('show more', sets)!)
  assert.ok('clarify' in r && /already shown/.test(r.clarify))
})

test('a kind hint picks the matching list', () => {
  const sets = [
    ...setsFrom([{ name: 'quotes.list', data: { rows: [{ id: 'q1', quoteNumber: 'Q-1' }, { id: 'q2', quoteNumber: 'Q-2' }], total: 2 }, links: [] }]),
    ...setsFrom([ordersResult]),
  ]
  assert.deepEqual(intentForFollowUp(resolveFollowUp('open the first order', sets)!), { tools: ['orders.detail'], orderId: 'ord_1' })
  assert.deepEqual(intentForFollowUp(resolveFollowUp('open the second quote', sets)!), { tools: ['quotes.detail'], quoteId: 'q2' })
})

test('explicit record numbers are lookups, not follow-ups', () => {
  assert.equal(resolveFollowUp('show order ORD-1005 first', setsFrom([ordersResult])), undefined)
})

test('liveResultSets drops expired sets and sets from another user, role or tenant', () => {
  const [set] = setsFrom([ordersResult])
  const meta = [{ resultSets: [set] }]
  assert.equal(liveResultSets(meta, SCOPE, NOW).length, 1)
  assert.equal(liveResultSets(meta, SCOPE, new Date(NOW.getTime() + RESULT_SET_TTL_MS + 1)).length, 0)
  assert.equal(liveResultSets(meta, { ...SCOPE, userId: 'u2' }, NOW).length, 0)
  assert.equal(liveResultSets(meta, { ...SCOPE, role: 'WAREHOUSE_STAFF' }, NOW).length, 0)
  assert.equal(liveResultSets(meta, { ...SCOPE, tenantId: 't2' }, NOW).length, 0)
  assert.equal(liveResultSets([null, { resultSets: 'junk' }, { resultSets: [{ nope: 1 }] }], SCOPE, NOW).length, 0)
})
