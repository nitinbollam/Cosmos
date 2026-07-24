import test from 'node:test'
import assert from 'node:assert/strict'
import { detectIntent, isHowToQuestion, isPlainLanguagePreferred } from './intent'

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

test('detectIntent picks warehouse list for admin', () => {
  const intent = detectIntent('what are different warehouses we have?', false)
  assert.ok(intent.tools.includes('list_warehouses'))
  assert.equal(intent.tools.includes('global_search'), false)
})

test('detectIntent picks pending order filter', () => {
  const intent = detectIntent('any orders pending?', false)
  assert.ok(intent.tools.includes('get_my_orders'))
  assert.equal(intent.orderStatus, 'PENDING')
})

test('detectIntent skips tools for how-to POS question', () => {
  const intent = detectIntent('How POS works in pleros?', false)
  assert.deepEqual(intent.tools, [])
  assert.ok(isHowToQuestion('How POS works in pleros?'))
})

test('isHowToQuestion allows data questions', () => {
  assert.equal(isHowToQuestion('how many warehouses do we have?'), false)
  assert.equal(isHowToQuestion('show pending orders'), false)
})

test('isPlainLanguagePreferred for general Pleros overview', () => {
  assert.equal(isPlainLanguagePreferred('How pleros works?'), true)
  assert.equal(isPlainLanguagePreferred('What is Pleros?'), true)
  assert.equal(isPlainLanguagePreferred('show pending orders'), false)
})
