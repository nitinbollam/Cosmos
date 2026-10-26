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
