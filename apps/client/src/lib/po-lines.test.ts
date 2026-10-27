import assert from 'node:assert/strict'
import test from 'node:test'
import { poLineProblems, type PoFormLine } from './po-lines'

const line = (over: Partial<PoFormLine> = {}): PoFormLine => ({
  key: 1,
  skuId: 'sku-1',
  skuIsActive: true,
  skuCode: 'COLA-12',
  description: '',
  qtyOrdered: '10',
  unitCost: '4.50',
  ...over,
})

test('a complete line has no problems, and a blank description is fine', () => {
  assert.deepEqual(poLineProblems([line()]), [[]])
})

test('a blank line names every field that is missing', () => {
  assert.deepEqual(poLineProblems([line({ skuCode: '  ', qtyOrdered: '', unitCost: '' })]), [
    ['SKU code is required', 'Quantity must be a whole number of 1 or more', "Enter a unit cost (0 if it's free)"],
  ])
})

test('a typed SKU code must be selected from search results before the line is valid', () => {
  assert.deepEqual(poLineProblems([line({ skuId: undefined, skuIsActive: undefined })]), [['Select an active SKU from the search results']])
  assert.deepEqual(poLineProblems([line({ skuIsActive: false })]), [['Select an active SKU from the search results']])
})

test('quantity must be a whole number of at least 1', () => {
  for (const qtyOrdered of ['0', '-3', '2.5', 'abc']) {
    assert.deepEqual(poLineProblems([line({ qtyOrdered })]), [['Quantity must be a whole number of 1 or more']], qtyOrdered)
  }
  assert.deepEqual(poLineProblems([line({ unitCost: '0' })]), [[]])
})

test('the same SKU twice is flagged on the later line', () => {
  assert.deepEqual(poLineProblems([line(), line({ key: 2, skuCode: ' COLA-12 ' })]), [[], ['SKU COLA-12 is already on line 1']])
})
