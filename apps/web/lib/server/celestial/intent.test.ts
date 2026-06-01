import test from 'node:test'
import assert from 'node:assert/strict'
import { detectIntent } from './intent'

test('detectIntent picks order tools for buyer', () => {
  const intent = detectIntent('Where is my order shipment?', true)
  assert.ok(intent.tools.includes('get_my_orders'))
})

test('detectIntent picks invoice tools', () => {
  const intent = detectIntent('Show my open invoices and balance due', true)
  assert.ok(intent.tools.includes('list_my_invoices'))
})

test('detectIntent picks admin global search', () => {
  const intent = detectIntent('Find customer Acme', false)
  assert.ok(intent.tools.includes('global_search'))
})
