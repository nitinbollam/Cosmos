import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeLookups, linkCalls, readBudget } from './cross-module'
import type { DetectedIntent } from './intent'
import type { ToolResult } from './tools'
import { parsePlan, routingDoubt, MAX_PLANNED_CALLS, allowedPlannerTools } from './planner'
import type { SessionUser } from '../session'

const ADMIN = { userId: 'u', tenantId: 't', role: 'TENANT_ADMIN', email: 'a@x', permissions: [] } as unknown as SessionUser
const range = (label: string, from: string) => ({ label, from: new Date(from), to: new Date(from) })
const ok = (name: ToolResult['name'], data: unknown): ToolResult => ({ name, data, links: [] })

test('related lookups share the supplier, customer or product that one of them names', () => {
  const linked = linkCalls([
    { tools: ['purchasing.orders'], supplier: 'Pacific' },
    { tools: ['finance.bills'], outstanding: true },
    { tools: ['orders.list'], customer: 'Acme' },
    { tools: ['list_my_invoices'] },
    { tools: ['inventory.by_warehouse'] },
  ])
  assert.equal(linked[1].supplier, 'Pacific')
  assert.equal(linked[3].customer, 'Acme')
  assert.equal(linked[4].supplier, undefined, 'unrelated lookups are left alone')
})

test('deliberately different names, periods and duplicates are handled', () => {
  const two = linkCalls([
    { tools: ['finance.bills'], supplier: 'Pacific' },
    { tools: ['finance.bills'], supplier: 'Acme' },
    { tools: ['purchasing.orders'] },
  ])
  assert.equal(two[2].supplier, undefined, 'two suppliers named: nothing is guessed')
  const periods = linkCalls([
    { tools: ['finance.bills'], supplier: 'Pacific' },
    { tools: ['finance.bills'] },
  ])
  assert.equal(periods[1].supplier, undefined, 'the same lookup twice is a comparison, not a link')
  assert.equal(linkCalls([{ tools: ['orders.list'] }, { tools: ['orders.list'] }]).length, 1, 'exact duplicates run once')
})

test('the planner accepts up to six lookups and routes comparisons to it', () => {
  assert.equal(MAX_PLANNED_CALLS, 6)
  const calls = Array.from({ length: 8 }, (_, i) => ({ tool: 'sales.summary', params: { period: `q${(i % 4) + 1} 2026` } }))
  const plan = parsePlan(JSON.stringify({ type: 'tools', calls }), allowedPlannerTools(ADMIN))
  assert.equal(plan?.type === 'tools' && plan.calls.length, 6)
  assert.ok(routingDoubt('what is our net position', { tools: ['finance.bills'] }, false))
  assert.ok(routingDoubt('receivables and payables', { tools: ['finance.bills'] }, false))
})

test('a slow lookup is reported as missing while the others answer', async () => {
  const budget = readBudget({ CELESTIAL_READ_TIMEOUT_MS: '30', CELESTIAL_READS_BUDGET_MS: '1000' })
  const started = Date.now()
  const out = await budget.run([{ tools: ['orders.list'] }, { tools: ['finance.bills'] }], async (call) =>
    call.tools[0] === 'finance.bills' ? new Promise<ToolResult[]>(() => {}) : [ok('orders.list', { rows: [], total: 0 })],
  )
  assert.ok(Date.now() - started < 500, 'does not wait for the slow read')
  assert.equal(out[0][0].data && (out[0][0].data as { total: number }).total, 0)
  assert.equal(out[1][0].name, 'finance.bills')
  assert.equal(out[1][0].error, 'timed out')
  assert.match(out[1][0].notice ?? '', /vendor bills took too long/)
})

test('a single lookup is only held to the overall budget', async () => {
  const budget = readBudget({ CELESTIAL_READ_TIMEOUT_MS: '10', CELESTIAL_READS_BUDGET_MS: '1000' })
  const out = await budget.run([{ tools: ['sales.by_product'] }], async () => {
    await new Promise((r) => setTimeout(r, 40))
    return [ok('sales.by_product', { rows: [] })]
  })
  assert.equal(out[0][0].error, undefined, 'a slow single ranking still answers')
})

test('a spent budget skips the remaining reads', async () => {
  let t = 0
  const budget = readBudget({ CELESTIAL_READS_BUDGET_MS: '100' }, () => t)
  t = 150
  let ran = false
  const out = await budget.run([{ tools: ['orders.list'] }], async () => {
    ran = true
    return []
  })
  assert.equal(ran, false)
  assert.match(out[0][0].notice ?? '', /took too long/)
})

test('sales over two periods: change in revenue and orders, oldest period first', () => {
  const calls: DetectedIntent[] = [
    { tools: ['sales.summary'], dateRange: range('Q4 2026', '2026-10-01') },
    { tools: ['sales.summary'], dateRange: range('Q3 2026', '2026-07-01') },
  ]
  const out = analyzeLookups(calls, [
    [ok('sales.summary', { label: 'Q4 2026', totalOrders: 12, totalRevenue: 1250.5, truncated: false })],
    [ok('sales.summary', { label: 'Q3 2026', totalOrders: 10, totalRevenue: 1000, truncated: false })],
  ])!
  assert.match(out, /### Sales comparison/)
  assert.ok(out.indexOf('Q3 2026 |') < out.indexOf('Q4 2026 |'))
  assert.match(out, /Q3 2026 → Q4 2026: revenue \*\*\+250\.50\*\* \(\+25.1%\), orders \*\*\+2\*\*/)
  assert.doesNotMatch(out, /\$/, 'orders store no currency, so none is shown')
})

test('a partial sales total is not compared', () => {
  const calls: DetectedIntent[] = [
    { tools: ['sales.summary'], dateRange: range('Q3 2026', '2026-07-01') },
    { tools: ['sales.summary'], dateRange: range('Q4 2026', '2026-10-01') },
  ]
  const out = analyzeLookups(calls, [
    [ok('sales.summary', { totalOrders: 10, totalRevenue: 1000, truncated: true })],
    [ok('sales.summary', { totalOrders: 12, totalRevenue: 1500, truncated: false })],
  ])!
  assert.match(out, /not compared, because one of the totals is partial/)
  assert.doesNotMatch(out, /revenue \*\*/)
})

test('receivables vs payables: per currency, never mixed, with the net', () => {
  const calls: DetectedIntent[] = [
    { tools: ['list_my_invoices'], outstanding: true },
    { tools: ['finance.bills'], outstanding: true },
  ]
  const out = analyzeLookups(calls, [
    [ok('list_my_invoices', { rows: [], total: 3, openInvoices: 3, openBalanceByCurrency: { USD: 900 }, totalsTruncated: false })],
    [ok('finance.bills', { rows: [], total: 2, balanceByCurrency: { USD: 1200.25, EUR: 50 }, totalsTruncated: false })],
  ])!
  assert.match(out, /\| USD \| \$900\.00 \| \$1200\.25 \| \*\*-\$300\.25\*\* \|/)
  assert.match(out, /\| EUR \| 0\.00 EUR \| 50\.00 EUR \| \*\*-50\.00 EUR\*\* \|/)
  assert.match(out, /Currencies are kept separate/)
})

test('receivables vs payables also works for the keyword shape: one lookup running both tools', () => {
  const out = analyzeLookups(
    [{ tools: ['finance.bills', 'list_my_invoices'] }],
    [[
      ok('finance.bills', { rows: [], total: 4, balanceByCurrency: { USD: 20 }, totalsTruncated: false }),
      ok('list_my_invoices', { rows: [], total: 1, openInvoices: 1, openBalanceByCurrency: { USD: 50 }, totalsTruncated: false }),
    ]],
  )!
  assert.match(out, /\| USD \| \$50\.00 \| \$20\.00 \| \*\*\+\$30\.00\*\* \|/)
})

test('receivables vs payables says what is missing instead of treating it as zero', () => {
  const calls: DetectedIntent[] = [{ tools: ['list_my_invoices'] }, { tools: ['finance.bills'] }]
  const out = analyzeLookups(calls, [
    [ok('list_my_invoices', { rows: [], total: 0, openInvoices: 0, openBalanceByCurrency: {}, totalsTruncated: false })],
    [{ name: 'finance.bills', data: null, links: [], error: 'timed out', notice: 'slow' }],
  ])!
  assert.match(out, /Not compared: vendor bills could not be read/)
  const partial = analyzeLookups(calls, [
    [ok('list_my_invoices', { openInvoices: 1, openBalanceByCurrency: { USD: 10 }, totalsTruncated: true })],
    [ok('finance.bills', { total: 1, balanceByCurrency: { USD: 5 }, totalsTruncated: false })],
  ])!
  assert.match(partial, /\| USD \| \$10\.00 \| \$5\.00 \| — \|/)
  assert.match(partial, /Net not shown/)
})

test('a supplier across POs and bills compares ordered vs billed only when nothing is unknown', () => {
  const calls: DetectedIntent[] = [
    { tools: ['purchasing.orders'], supplier: 'Pacific' },
    { tools: ['finance.bills'], supplier: 'Pacific' },
  ]
  const bills = ok('finance.bills', {
    rows: [{ totalAmount: 400, currency: 'USD', status: 'ISSUED' }, { totalAmount: 999, currency: 'USD', status: 'VOID' }],
    total: 2,
    page: 1,
    balanceByCurrency: { USD: 150 },
    totalsTruncated: false,
  })
  const complete = analyzeLookups(calls, [
    [ok('purchasing.orders', { rows: [{ goodsCost: 500, currency: 'USD', missingCostLines: 0, status: 'SUBMITTED' }, { goodsCost: 70, currency: 'USD', missingCostLines: 0, status: 'CANCELLED' }], total: 2, page: 1 })],
    [bills],
  ])!
  assert.match(complete, /### Pacific: purchase orders and bills/)
  assert.match(complete, /open balance \$150\.00/)
  assert.match(complete, /goods ordered \$500\.00, billed \$400\.00, difference \*\*\+\$100\.00\*\*/)

  const unknown = analyzeLookups(calls, [
    [ok('purchasing.orders', { rows: [{ goodsCost: null, currency: 'USD', missingCostLines: 2, status: 'SUBMITTED' }], total: 1, page: 1 })],
    [bills],
  ])!
  assert.match(unknown, /2 PO line\(s\) have no unit cost/)
  assert.doesNotMatch(unknown, /difference/)

  const paged = analyzeLookups(calls, [
    [ok('purchasing.orders', { rows: [{ goodsCost: 5, currency: 'USD', missingCostLines: 0, status: 'SUBMITTED' }], total: 20, page: 1 })],
    [bills],
  ])!
  assert.match(paged, /not every record fits in one answer/)
})

test('one customer across orders, quotes and invoices', () => {
  const calls: DetectedIntent[] = [
    { tools: ['orders.list'], customer: 'Acme' },
    { tools: ['quotes.list'], customer: 'Acme' },
    { tools: ['list_my_invoices'], customer: 'Acme', outstanding: true },
  ]
  const out = analyzeLookups(calls, [
    [ok('orders.list', { rows: [], total: 14 })],
    [ok('quotes.list', { rows: [], total: 3 })],
    [ok('list_my_invoices', { rows: [], total: 2, openInvoices: 2, openBalanceByCurrency: { USD: 75 }, totalsTruncated: false })],
  ])!
  assert.match(out, /### Acme at a glance/)
  assert.match(out, /Orders:\*\* 14/)
  assert.match(out, /Quotes:\*\* 3/)
  assert.match(out, /Unpaid invoices:\*\* 2, still owed \$75\.00/)
})

test('unrelated or single lookups get no comparison', () => {
  assert.equal(analyzeLookups([{ tools: ['orders.list'] }], [[ok('orders.list', { rows: [], total: 1 })]]), null)
  assert.equal(
    analyzeLookups(
      [{ tools: ['inventory.by_warehouse'] }, { tools: ['list_warehouses'] }],
      [[ok('inventory.by_warehouse', { rows: [] })], [ok('list_warehouses', [])]],
    ),
    null,
  )
})
