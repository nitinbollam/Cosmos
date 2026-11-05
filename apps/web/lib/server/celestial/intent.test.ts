import test from 'node:test'
import assert from 'node:assert/strict'
import { detectCombination, detectIntent, isHowToQuestion, isPlainLanguagePreferred, uncoveredTopics } from './intent'

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

test('requisition questions use the requisition lookup, never purchase orders', () => {
  const pending = detectIntent('any purchase requisitions waiting for approval?', false)
  assert.deepEqual(pending.tools, ['purchasing.requisitions'])
  assert.equal(pending.requisitionStatus, 'PENDING_APPROVAL')

  const open = detectIntent('show open requisitions', false)
  assert.deepEqual(open.tools, ['purchasing.requisitions'])
  assert.deepEqual(open.requisitionStatuses, ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'])

  const converted = detectIntent('which requisitions were converted to a PO?', false)
  assert.deepEqual(converted.tools, ['purchasing.requisitions'])
  assert.equal(converted.requisitionStatus, 'CONVERTED')

  assert.equal(detectIntent('requisitions not yet converted to orders', false).requisitionStatus, 'APPROVED')
  assert.equal(detectIntent('show the latest requisition', false).limit, 1)
})

test('a requisition number reads that requisition', () => {
  for (const q of ['status of PR-1001', 'what happened to requisition 1001?']) {
    const intent = detectIntent(q, false)
    assert.deepEqual(intent.tools, ['purchasing.requisition_detail'])
    assert.equal(intent.requisitionRef, 'PR-1001')
  }
})

test('requisition how-to questions are answered from the guides', () => {
  for (const q of ['how do I raise a purchase requisition?', 'how do I approve an open requisition?', 'what is a requisition?']) {
    assert.equal(isHowToQuestion(q), true, q)
    assert.deepEqual(detectIntent(q, false).tools, [], q)
  }
  assert.equal(isHowToQuestion('show open requisitions'), false)
})

test('bills "due" in a period filter by due date and leave out paid bills', () => {
  const due = detectIntent('bills due this month', false)
  assert.deepEqual(due.tools, ['finance.bills'])
  assert.equal(due.byDueDate, true)
  assert.equal(due.outstanding, true)
  assert.equal(due.dateRange?.label, 'this month')
  assert.equal(detectIntent('bills due next week', false).dateRange?.label, 'next week')
  // No "due": the period still means when the bill was issued.
  assert.equal(detectIntent('bills from last month', false).byDueDate, undefined)
  assert.equal(detectIntent('which vendor bills are past due?', false).byDueDate, undefined)
})

test('questions naming two linked lookups run both', () => {
  const toolsOf = (q: string) => detectCombination(q, false)?.flatMap((c) => c.tools)
  for (const q of ['are we net positive on what we owe and are owed?', 'how much do we owe vs how much are we owed?', 'compare receivables and payables']) {
    assert.deepEqual(toolsOf(q), ['list_my_invoices', 'finance.bills'], q)
  }
  const supplier = detectCombination('what have we ordered and been billed by Pacific Supply?', false)!
  assert.deepEqual(supplier.flatMap((c) => c.tools), ['purchasing.orders', 'finance.bills'])
  assert.deepEqual(supplier.map((c) => c.supplier), ['Pacific Supply', 'Pacific Supply'])

  for (const [q, product] of [['stock and sales for energy drinks', ['energy', 'drinks']], ['how much cable stock do we have and is it selling?', ['cable']]] as const) {
    const calls = detectCombination(q, false)!
    assert.deepEqual(calls.flatMap((c) => c.tools), ['inventory.stock', 'sales.by_product'], q)
    assert.deepEqual(calls.map((c) => c.searchTokens), [product, product], q)
  }
})

test('single-lookup questions are not treated as combinations', () => {
  for (const q of ['what is my most selling stock', 'what do we owe?', 'how much do customers owe us?', 'show purchase orders', 'is PO-1001 billed and ordered?']) {
    assert.equal(detectCombination(q, false), null, q)
  }
  assert.equal(detectCombination('compare receivables and payables', true), null)
})

test('invoice periods mean the due date only when the question says due', () => {
  const due = detectIntent('invoices due this month', false)
  assert.deepEqual(due.tools, ['list_my_invoices'])
  assert.equal(due.byDueDate, true)
  assert.equal(due.outstanding, true)
  const issued = detectIntent('invoices from last month', false)
  assert.equal(issued.dateRange?.label, 'last month')
  assert.equal(issued.byDueDate, undefined)
  const overdue = detectIntent('which invoices are overdue?', false)
  assert.equal(overdue.pastDue, true)
  assert.equal(overdue.byDueDate, undefined)
})

test('each part that is its own data question gets its own lookup', () => {
  const toolsOf = (q: string) => detectCombination(q, false)?.map((c) => c.tools.join('+'))
  assert.deepEqual(toolsOf('show pending orders and low stock'), ['orders.list', 'list_low_stock'])
  assert.deepEqual(toolsOf('any requisitions waiting for approval, unpaid invoices and open quotes'), ['purchasing.requisitions', 'list_my_invoices', 'quotes.list'])
  assert.deepEqual(toolsOf('how many orders and how many quotes do we have'), ['orders.list', 'quotes.list'])
  assert.deepEqual(detectCombination('show pending orders and low stock', false)?.[0].orderStatus, 'PENDING')
})

test('a closing period covers every part; an earlier one stays put', () => {
  const closing = detectCombination('quotes and orders this month', false)!
  assert.deepEqual(closing.map((c) => c.dateRange?.label), ['this month', 'this month'])
  const early = detectCombination('orders this month and unpaid invoices', false)!
  assert.deepEqual(early.map((c) => c.dateRange?.label), ['this month', undefined])
})

test('"and" inside one topic is not split', () => {
  for (const q of ['orders from Acme and Pacific', 'pending and shipped orders', 'what is the status of order 1003 and who bought it', 'which warehouses and locations do we have']) {
    assert.equal(detectCombination(q, false), null, q)
  }
})

test('uncoveredTopics names only what a multi-topic question left out', () => {
  assert.deepEqual(uncoveredTopics('show orders with their invoices', ['orders.list']), ['customer invoices'])
  assert.deepEqual(uncoveredTopics('show orders with their invoices', ['orders.list', 'list_my_invoices']), [])
  assert.deepEqual(uncoveredTopics('show orders', ['orders.list']), [])
  assert.deepEqual(uncoveredTopics('purchase orders from Pacific', ['purchasing.orders']), [])
  assert.deepEqual(uncoveredTopics('has the quote been converted to an order?', ['quotes.list']), [])
  assert.deepEqual(uncoveredTopics('what is my most selling stock', ['sales.by_product']), [])
  assert.deepEqual(uncoveredTopics('show sales orders', ['orders.list']), [])
})

test('a period naming when the last part falls due stays with that part', () => {
  const calls = detectCombination('any quotes waiting for approval, unpaid invoices and bills due this month', false)!
  assert.deepEqual(calls.map((c) => c.tools[0]), ['quotes.list', 'list_my_invoices', 'finance.bills'])
  assert.deepEqual(calls.map((c) => c.dateRange?.label), [undefined, undefined, 'this month'])
  assert.equal(calls[0].quoteStatus, 'PENDING_APPROVAL')
  assert.equal(calls[2].byDueDate, true)
})

test('a part that is only a period repeats the lookup before it', () => {
  const calls = detectCombination('show sales this quarter and last quarter', false)!
  assert.deepEqual(calls.map((c) => c.tools[0]), ['sales.summary', 'sales.summary'])
  assert.notEqual(calls[0].dateRange?.label, calls[1].dateRange?.label)
})

test('names the rules did not read go to the router instead of being dropped', () => {
  for (const q of ['show me Acme orders along with their invoices', 'Pacific Supply POs and how much we owe them', "Pacific Supply's POs and bills"]) {
    assert.equal(detectCombination(q, false), null, q)
  }
  assert.ok(detectCombination('Pending orders and low stock', false))
  assert.ok(detectCombination('quotes and orders for Acme', false))
  assert.ok(detectCombination('what have we ordered and been billed by Pacific Supply?', false))
})

test('several order statuses are all kept', () => {
  const both = detectIntent('pending and shipped orders', false)
  assert.deepEqual(both.orderStatuses, ['PENDING', 'SHIPPED'])
  assert.equal(both.orderStatus, undefined)
  assert.equal(detectIntent('orders awaiting approval', false).orderStatus, 'AWAITING_APPROVAL')
  assert.equal(detectIntent('orders waiting for approval', false).orderStatus, 'AWAITING_APPROVAL')
  assert.equal(detectIntent('show pending orders', false).orderStatus, 'PENDING')
})

test('customer rankings about stock or units rank by units and are not read as two topics', () => {
  for (const q of ['which customer orders the most stock?', 'who bought the most units?', 'which customer buys the most products?']) {
    const i = detectIntent(q, false)
    assert.deepEqual(i.tools, ['sales.by_customer'], q)
    assert.equal(i.byUnits, true, q)
  }
  assert.deepEqual(uncoveredTopics('which customer orders the most stock?', ['sales.by_customer']), [])
  assert.equal(detectIntent('who is our best customer?', false).byUnits, undefined)
  assert.equal(detectIntent('which customer spent the most?', false).byUnits, undefined)
})
