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

test('composeFromToolResults lists orders from tool data', () => {
  const reply = composeFromToolResults([
    {
      name: 'get_my_orders',
      data: [
        {
          id: 'seed_ord_pending',
          status: 'PENDING',
          total: 249.9,
          createdAt: '2026-06-01T12:00:00.000Z',
          lineCount: 2,
        },
      ],
      links: [{ label: 'Order', href: '/admin/orders/seed_ord_pending' }],
    },
  ])
  assert.match(reply, /PENDING/)
  assert.match(reply, /\$249\.90/)
})

test('composeFromToolResults reports empty order results', () => {
  const reply = composeFromToolResults([{ name: 'get_my_orders', data: [], links: [] }])
  assert.equal(reply, '')
  assert.equal(toolResultHasData({ name: 'get_my_orders', data: [], links: [] }), false)
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
