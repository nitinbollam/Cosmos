import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyProduct, quoteLinesProblem, type QuoteLineDraft } from './quote-lines'

const line = (over: Partial<QuoteLineDraft> = {}): QuoteLineDraft => ({ lineNo: 1, skuCode: 'OFF-PEN-100', description: 'Pens', qty: '10', unitPrice: '20', ...over })

test('every line needs a product, a whole quantity and a price', () => {
  assert.equal(quoteLinesProblem([line()]), null)
  assert.equal(quoteLinesProblem([]), 'Add at least one line')
  assert.equal(quoteLinesProblem([line({ skuCode: ' ' })]), 'Line 1: choose a product')
  assert.match(quoteLinesProblem([line({ qty: '1.5' })]) ?? '', /whole number/)
  assert.match(quoteLinesProblem([line({ unitPrice: '' })]) ?? '', /unit price/)
  assert.equal(quoteLinesProblem([line({ unitPrice: '0' })]), null, 'a free line is allowed')
})

test('picking a product fills blanks but keeps what the buyer typed', () => {
  const sku = { code: 'OFF-PEN-100', name: 'Office Pen Pack', price: '24.00' }
  assert.deepEqual(applyProduct(line({ skuCode: '', description: 'Item', unitPrice: '0' }), sku), line({ description: 'Office Pen Pack', unitPrice: '24' }))
  assert.deepEqual(applyProduct(line({ skuCode: '', description: 'Blue pens', unitPrice: '20' }), sku), line({ description: 'Blue pens' }))
})
