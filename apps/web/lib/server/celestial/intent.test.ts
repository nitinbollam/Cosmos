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

test('detectIntent: "which product has the least stock" ranks products, not a search for "least"', () => {
  for (const q of ['which product has the least stock', 'which product has least stock', 'what has the lowest stock?']) {
    const intent = detectIntent(q, false)
    assert.deepEqual(intent.tools, ['inventory.stock'], q)
    assert.deepEqual(intent.searchTokens, [], q)
    assert.equal(intent.stockRank, 'asc', q)
  }
})

test('detectIntent: "most stock" ranks descending and keeps a product filter', () => {
  const intent = detectIntent('which cable has the most stock?', false)
  assert.equal(intent.stockRank, 'desc')
  assert.deepEqual(intent.searchTokens, ['cable'])
})

test('detectIntent: plain stock questions are not ranked', () => {
  assert.equal(detectIntent('how much cable stock do we have?', false).stockRank, undefined)
})

test('detectIntent: the screenshot question (with typo) routes to the sales forecast', () => {
  assert.deepEqual(detectIntent('what is predicted sales of next quater', false).tools, ['sales.forecast'])
  assert.deepEqual(detectIntent('forecast revenue for next quarter', false).tools, ['sales.forecast'])
})

test('detectIntent: sales totals by period', () => {
  const intent = detectIntent('what were our sales last quarter?', false)
  assert.deepEqual(intent.tools, ['sales.summary'])
  assert.equal(intent.dateRange?.from.getUTCMonth() !== undefined, true)
})

test('detectIntent: "sales rep orders" and "sales tax" are not sales totals', () => {
  assert.equal(detectIntent('show sales rep orders', false).tools.includes('sales.summary'), false)
  assert.equal(detectIntent('show sales tax settings', false).tools.includes('sales.summary'), false)
})

test('detectIntent: "which product has the most sales" ranks products by sales only', () => {
  for (const q of ['which product has the most sales', 'best selling products', 'which products sold the most?', 'top sellers this quarter']) {
    const intent = detectIntent(q, false)
    assert.deepEqual(intent.tools, ['sales.by_product'], q)
    assert.equal(intent.salesRank, 'desc', q)
    assert.deepEqual(intent.searchTokens, [], q)
  }
})

test('detectIntent: worst sellers rank lowest first and keep product filters', () => {
  const intent = detectIntent('which cable product has the least sales last month?', false)
  assert.deepEqual(intent.tools, ['sales.by_product'])
  assert.equal(intent.salesRank, 'asc')
  assert.deepEqual(intent.searchTokens, ['cable'])
  assert.equal(intent.dateRange?.label, 'last month')
})

test('detectIntent: overall sales questions still use sales totals', () => {
  assert.deepEqual(detectIntent('what were total sales this year?', false).tools, ['sales.summary'])
})

test('detectIntent: single-answer superlatives ask for one result, "top N" for N', () => {
  const most = detectIntent('what is my most selling stock', false)
  assert.deepEqual(most.tools, ['sales.by_product'])
  assert.equal(most.limit, 1)
  assert.equal(detectIntent('which product has the least stock', false).limit, 1)
  assert.equal(detectIntent('top 5 products by sales', false).limit, 5)
  assert.equal(detectIntent('top sellers this quarter', false).limit, undefined)
  assert.equal(detectIntent('which products sold the least?', false).limit, undefined)
  assert.equal(detectIntent('how much cable stock do we have?', false).limit, undefined)
})

test('detectIntent: assistant-style questions map to the right lookup', () => {
  const t = (q: string) => detectIntent(q, false)
  assert.deepEqual(t('any orders waiting to ship?').orderStatuses, ['PENDING', 'AWAITING_APPROVAL', 'CONFIRMED', 'BACKORDERED', 'PROCESSING', 'PACKED'])
  assert.equal(t('show me the latest order').limit, 1)
  assert.equal(t('show me the latest orders').limit, undefined)
  const biggest = t('what was our biggest order?')
  assert.equal(biggest.byAmount, true)
  assert.equal(biggest.limit, 1)
  assert.deepEqual(t('what is still to be received?').tools, ['purchasing.orders'])
  assert.deepEqual(t('what have we ordered from suppliers?').tools, ['purchasing.orders'])
  assert.deepEqual(t('who are our suppliers?').tools, ['purchasing.suppliers'])
  assert.deepEqual(t('who is our best customer?').tools, ['sales.by_customer'])
  assert.deepEqual(t('which customer orders the most?').tools, ['sales.by_customer'])
  assert.deepEqual(t('what is our average order value?').tools, ['sales.summary'])
  assert.deepEqual(t('how are sales this month?').tools, ['sales.summary'])
  assert.deepEqual(t('top 3 products').tools, ['sales.by_product'])
  assert.deepEqual(t('which warehouse has the most stock').tools, ['inventory.by_warehouse'])
  const cheap = t('cheapest product')
  assert.deepEqual([cheap.tools, cheap.priceRank, cheap.limit], [['search_catalog'], 'asc', 1])
  assert.equal(t("has Acme's quote been converted to an order?").customer, 'Acme')
  assert.deepEqual(t("has Acme's quote been converted to an order?").tools, ['quotes.list'])
  assert.equal(t('any unpaid invoices from Acme?').outstanding, true)
  const newark = t('what is in stock in Newark?')
  assert.deepEqual([newark.tools, newark.warehouse, newark.searchTokens], [['inventory.stock'], 'Newark', []])
  assert.deepEqual(t('who is the customer?').tools, [])
})

test('isHowToQuestion: only procedural questions are how-to', () => {
  assert.equal(isHowToQuestion('how are sales this month?'), false)
  assert.equal(isHowToQuestion('how do I create a purchase order?'), true)
  assert.equal(isHowToQuestion('how can I add a new user?'), true)
})
