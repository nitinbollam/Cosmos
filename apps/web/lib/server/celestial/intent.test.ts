import test from 'node:test'
import assert from 'node:assert/strict'
import { detectIntent, isHowToQuestion, isPlainLanguagePreferred } from './intent'

test('detectIntent picks order tools for buyer', () => {
  const intent = detectIntent('Where is my order shipment?', true)
  assert.ok(intent.tools.includes('orders.list'))
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
  assert.ok(intent.tools.includes('orders.list'))
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

test('detectIntent: backordered orders last month, oldest first', () => {
  const intent = detectIntent('Show backordered orders from last month, oldest first', false)
  assert.deepEqual(intent.tools, ['orders.list'])
  assert.equal(intent.orderStatus, 'BACKORDERED')
  assert.equal(intent.dateRange?.label, 'last month')
  assert.equal(intent.sort, 'asc')
})

test('detectIntent: order number goes to orders.detail', () => {
  const intent = detectIntent('What is the status of order ORD-1001?', false)
  assert.ok(intent.tools.includes('orders.detail'))
  assert.equal(intent.orderNumber, 1001)
})

test('detectIntent: channel and priority filters', () => {
  const intent = detectIntent('show urgent shopify orders', false)
  assert.equal(intent.channel, 'SHOPIFY')
  assert.equal(intent.priority, 'URGENT')
})

test('detectIntent: purchase orders are not sales orders', () => {
  const intent = detectIntent('Show purchase orders from Acme Supply', false)
  assert.deepEqual(intent.tools, ['purchasing.orders'])
  assert.equal(intent.supplier, 'Acme Supply')
})

test('detectIntent: PO number goes to purchasing.order_detail', () => {
  const intent = detectIntent('show the lines on PO 1001', false)
  assert.deepEqual(intent.tools, ['purchasing.order_detail'])
  assert.equal(intent.poRef, 'PO-1001')
})

test('detectIntent: POS orders stay sales orders on the POS channel', () => {
  const intent = detectIntent('show POS orders today', false)
  assert.deepEqual(intent.tools, ['orders.list'])
  assert.equal(intent.channel, 'POS')
  assert.equal(intent.dateRange?.label, 'today')
})

test('detectIntent: vendor bills route to AP, not invoices', () => {
  const intent = detectIntent('which vendor bills are past due?', false)
  assert.deepEqual(intent.tools, ['finance.bills'])
  assert.equal(intent.pastDue, true)
})

test('detectIntent: paid bills set outstanding:false', () => {
  const intent = detectIntent('list fully paid bills', false)
  assert.equal(intent.outstanding, false)
})

test('detectIntent: quote number goes to quotes.detail', () => {
  const intent = detectIntent('show quote Q-AB12CD34', false)
  assert.deepEqual(intent.tools, ['quotes.detail'])
  assert.equal(intent.quoteRef, 'ab12cd34')
})

test('detectIntent: approved quotes', () => {
  const intent = detectIntent('list approved quotes', false)
  assert.deepEqual(intent.tools, ['quotes.list'])
  assert.equal(intent.quoteStatus, 'APPROVED')
})

test('detectIntent: stock per warehouse uses inventory.stock, not the warehouse list', () => {
  const intent = detectIntent('Which SKUs are available in each warehouse, grouped by SKU and unit?', false)
  assert.deepEqual(intent.tools, ['inventory.stock'])
  assert.deepEqual(intent.searchTokens, [])
})

test('detectIntent: "cable product" and "all products containing cable" resolve to the same lookup', () => {
  assert.deepEqual(detectIntent('show the cable product', false).searchTokens, ['cable'])
  assert.deepEqual(detectIntent('all products containing cable', false).searchTokens, ['cable'])
  assert.deepEqual(detectIntent('how much cable stock do we have?', false).searchTokens, ['cable'])
})

test('detectIntent: low stock does not also run a stock lookup', () => {
  const intent = detectIntent('Which products are low on stock?', false)
  assert.deepEqual(intent.tools, ['list_low_stock'])
})

test('detectIntent: bare product question has no invented search term', () => {
  const intent = detectIntent('show products', false)
  assert.deepEqual(intent.tools, ['search_catalog'])
  assert.deepEqual(intent.searchTokens, [])
})

test('detectIntent: a bare ORD- reference goes to orders.detail', () => {
  const intent = detectIntent('status of ORD-1001', false)
  assert.deepEqual(intent.tools, ['orders.detail'])
  assert.equal(intent.orderNumber, 1001)
})

test('detectIntent: "we owe" is accounts payable', () => {
  const intent = detectIntent('how much do we owe Pacific Supply?', false)
  assert.deepEqual(intent.tools, ['finance.bills'])
  assert.equal(intent.outstanding, true)
  assert.equal(intent.supplier, 'Pacific Supply')
})

test('detectIntent: "customers owe us" is accounts receivable', () => {
  const intent = detectIntent('which customers owe us money?', false)
  assert.deepEqual(intent.tools, ['list_my_invoices'])
})
