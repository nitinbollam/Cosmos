import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDocFallbackReply, composeFromToolResults, toolResultHasData } from './compose'

test('composeFromToolResults lists warehouses from tool data', () => {
  const reply = composeFromToolResults([
    {
      name: 'list_warehouses',
      data: [
        { code: 'MAIN', name: 'Main Warehouse', address: '100 Distribution Way, Dallas, TX', isDefault: true },
        { code: 'EAST', name: 'East Coast DC — Newark', address: '50 Port Terminal Blvd, Newark, NJ', isDefault: false },
      ],
      links: [],
    },
  ])
  assert.match(reply, /2 active/)
  assert.match(reply, /Main Warehouse/)
  assert.match(reply, /`MAIN`/)
})

test('composeFromToolResults lists orders with all-match count and filters', () => {
  const reply = composeFromToolResults([
    {
      name: 'orders.list',
      data: {
        rows: [
          {
            id: 'seed_ord_pending',
            orderNumber: 1001,
            status: 'PENDING',
            channel: 'B2B_PORTAL',
            priority: 'NORMAL',
            customerName: 'Acme Retail',
            totalAmount: 249.9,
            createdAt: '2026-06-01T12:00:00.000Z',
            lineCount: 2,
          },
        ],
        total: 12,
        pageSize: 8,
        filters: ['PENDING', 'last month'],
      },
      links: [{ label: 'Order', href: '/admin/orders/seed_ord_pending' }],
    },
  ])
  assert.match(reply, /ORD-1001/)
  assert.match(reply, /PENDING, last month/)
  assert.match(reply, /Showing 1–1 of 12 matches\. Say “show more”/)
  assert.match(reply, /249\.90/)
  // Orders carry no currency field, so no currency symbol is invented.
  assert.doesNotMatch(reply, /\$249/)
})

test('composeFromToolResults answers empty list queries directly', () => {
  const result = { name: 'orders.list' as const, data: { rows: [], total: 0, pageSize: 8, filters: ['BACKORDERED'] }, links: [] }
  assert.equal(toolResultHasData(result), true)
  assert.match(composeFromToolResults([result]), /No matching orders/)
})

test('composeFromToolResults keeps bill balances separated by currency', () => {
  const reply = composeFromToolResults([
    {
      name: 'finance.bills',
      data: {
        rows: [
          { id: 'b1', billNumber: 'VB-1', status: 'ISSUED', supplierName: 'Acme Supply', currency: 'USD', totalAmount: 100, balance: 100, issuedAt: '2026-09-01', dueAt: '2026-09-15', pastDue: true },
          { id: 'b2', billNumber: 'VB-2', status: 'PARTIALLY_PAID', supplierName: 'Euro Parts', currency: 'EUR', totalAmount: 80, balance: 30, issuedAt: '2026-09-02', dueAt: null, pastDue: false },
        ],
        total: 2,
        pageSize: 8,
        filters: ['outstanding'],
        balanceByCurrency: { USD: 100, EUR: 30 },
        totalsTruncated: false,
      },
      links: [],
    },
  ])
  assert.match(reply, /\$100\.00 \+ 30\.00 EUR/)
  assert.match(reply, /currencies kept separate/)
  assert.match(reply, /past due/)
})

test('composeFromToolResults reports unknown PO cost instead of zero', () => {
  const reply = composeFromToolResults([
    {
      name: 'purchasing.orders',
      data: {
        rows: [
          { id: 'po1', number: 'PO-1001', status: 'SUBMITTED', supplierName: 'Acme Supply', currency: 'USD', createdAt: '2026-09-01', lineCount: 2, qtyOrdered: 30, qtyReceived: 10, goodsCost: null, missingCostLines: 1 },
        ],
        total: 1,
        pageSize: 8,
        filters: [],
      },
      links: [],
    },
  ])
  assert.match(reply, /unknown \(1 line\(s\) without cost\)/)
  assert.match(reply, /10\/30/)
})

test('composeFromToolResults shows stock per warehouse with units', () => {
  const reply = composeFromToolResults([
    {
      name: 'inventory.stock',
      data: {
        rows: [
          { skuId: 's1', code: 'CBL-A', name: 'Cable A', unit: 'EACH', warehouseCode: 'MAIN', warehouseName: 'Main', onHand: 10, reserved: 2, available: 8, reorderPoint: 25 },
        ],
        totalRows: 1,
        skuSummaries: [{ code: 'CBL-A', name: 'Cable A', unit: 'EACH', available: 8, onHand: 10 }],
        matchedSkus: 1,
        search: 'cable',
      },
      links: [],
    },
  ])
  assert.match(reply, /matching “cable”/)
  assert.match(reply, /\*\*8\*\* EACH/)
  assert.match(reply, /\| 25 \|/)
})

test('composeFromToolResults surfaces notices (clarification / access)', () => {
  const result = { name: 'finance.bills' as const, data: null, links: [], notice: "You don't have access to vendor bills" }
  assert.equal(toolResultHasData(result), true)
  assert.match(composeFromToolResults([result]), /don't have access/)
})

test('buildDocFallbackReply provides helpful default', () => {
  const reply = buildDocFallbackReply('What is Pleros?', [])
  assert.match(reply, /Celestial/)
  assert.match(reply, /What is Pleros/)
})

test('buildDocFallbackReply uses documentation excerpts', () => {
  const reply = buildDocFallbackReply('How POS works?', [
    { heading: 'Tier 13 — POS', body: 'Admin POS checkout with register, customer, and cart.' },
  ])
  assert.match(reply, /POS/)
})

test('buildDocFallbackReply uses plain language intro for overview questions', () => {
  const reply = buildDocFallbackReply(
    'How pleros works?',
    [
      {
        heading: 'How Pleros works (plain language)',
        body: 'Pleros helps wholesale businesses take orders, ship from the warehouse, and get paid.',
      },
      {
        heading: 'Local development quickstart',
        body: 'npm run dev\nOpen http://localhost:4000',
      },
    ],
    true,
  )
  assert.match(reply, /simple explanation/i)
  assert.match(reply, /wholesale businesses/i)
  assert.doesNotMatch(reply, /npm run/)
})

test('composeFromToolResults ranks products by available stock', () => {
  const reply = composeFromToolResults([
    {
      name: 'inventory.stock',
      data: {
        rows: [],
        totalRows: 3,
        skuSummaries: [
          { skuId: 's1', code: 'ACC-CBL-USB', name: 'USB-C Cable 3ft', unit: 'EACH', available: 8, onHand: 8 },
          { skuId: 's2', code: 'ACC-STAND-01', name: 'Display Stand', unit: 'EACH', available: 64, onHand: 64 },
        ],
        matchedSkus: 3,
        rank: 'asc',
        noStockRecorded: 1,
        rankTruncated: false,
        search: '',
      },
      links: [],
    },
  ])
  assert.match(reply, /lowest first/)
  assert.match(reply, /\| 1 \| `ACC-CBL-USB` \| USB-C Cable 3ft \| \*\*8\*\* EACH/)
  assert.match(reply, /1 product\(s\) have no stock recorded/)
  assert.doesNotMatch(reply, /least/)
})

test('sales forecast with too little history says so and gives no number', () => {
  const reply = composeFromToolResults([
    {
      name: 'sales.forecast',
      data: {
        estimate: null,
        reason: 'Not enough history: a forecast needs 3 full quarters of sales, and sales here start in Q4 2026 (0 full quarters so far).',
        basis: [],
        target: 'Q1 2027',
        currentQuarter: { label: 'Q4 2026 so far', from: new Date(), to: new Date(), orders: 4, revenue: 621.78 },
        excludedStatuses: ['CANCELLED', 'FAILED', 'RETURNED'],
      },
      links: [],
    },
  ])
  assert.match(reply, /Sales forecast — Q1 2027/)
  assert.match(reply, /No forecast\.\*\* Not enough history/)
  assert.match(reply, /Q4 2026 so far: 621\.78 from 4 order/)
  assert.doesNotMatch(reply, /Estimated revenue/)
})

test('a single-answer ranking is one line, not a table', () => {
  const reply = composeFromToolResults([
    {
      name: 'sales.by_product',
      data: {
        label: 'last 4 quarters and this quarter so far',
        rank: 'desc',
        rows: [{ skuId: 's1', code: 'VAP-POD-001', name: 'Premium Nicotine Pod 5pk', unit: 'EACH', units: 10, revenue: 249.9 }],
        ranked: 4,
        truncated: false,
        excludedStatuses: ['CANCELLED'],
        limit: 1,
        search: '',
      },
      links: [],
    },
  ])
  assert.match(reply, /^\*\*Best seller — last 4 quarters and this quarter so far:\*\* \*\*Premium Nicotine Pod 5pk\*\* \(`VAP-POD-001`\) — 10 EACH sold, 249\.90 revenue\./)
  assert.match(reply, /Highest of 4 product\(s\)/)
  assert.doesNotMatch(reply, /\|/)
})

test('unpaid invoice filter with no matches answers plainly', () => {
  const reply = composeFromToolResults([
    { name: 'list_my_invoices', data: { rows: [], total: 0, filters: ['unpaid'], outstandingOnly: true }, links: [] },
  ])
  assert.equal(reply, '**Invoices — unpaid:** none — every matching invoice is fully paid.')
})

test('a name search with no match says it is a name search, not a stock check', () => {
  const reply = composeFromToolResults([
    { name: 'inventory.stock', data: { rows: [], totalRows: 0, skuSummaries: [], matchedSkus: 0, search: 'widgets' }, links: [] },
  ])
  assert.match(reply, /couldn’t find a product whose name or SKU matches “widgets”/)
  assert.match(reply, /not a stock check/)
})

test('a record picked from a list says how it was picked', () => {
  const reply = composeFromToolResults([
    {
      name: 'quotes.detail',
      data: {
        id: 'q1', quoteNumber: 'Q-1', status: 'OPEN', customerName: 'Acme', convertedOrderId: null, rejectionReason: null,
        approvedAt: null, createdAt: new Date('2026-10-08Z'), lines: [], quoteTotal: 0, selection: '#2 from your last list (Q-1).',
      },
      links: [],
    },
  ])
  assert.match(reply, /^\*\*#2 from your last list \(Q-1\)\.\*\*/)
})
