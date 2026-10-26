import assert from 'node:assert/strict'
import test from 'node:test'
import { assertValidPurchaseOrderLines, MAX_PO_LINE_QUANTITY } from './purchasing'

const line = (over: Record<string, unknown> = {}) => ({ lineNo: 1, skuCode: 'COLA-12', description: '', qtyOrdered: 10, unitCost: 4.5, ...over })
const refuses = (lines: unknown, message: string) =>
  assert.throws(() => assertValidPurchaseOrderLines(lines), (e: Error & { status?: number }) => e.message === message)

test('a PO line with a SKU and a whole quantity passes; description and unit cost are optional', () => {
  assertValidPurchaseOrderLines([line(), line({ lineNo: 2, skuCode: 'CHIPS-6', description: undefined, unitCost: undefined })])
})

test('a PO needs at least one line', () => {
  refuses([], 'A purchase order needs at least one line')
  refuses(undefined, 'A purchase order needs at least one line')
})

test('a blank or missing SKU code is refused, naming the line', () => {
  refuses([line({ skuCode: '' })], 'Line 1: SKU code is required')
  refuses([line(), line({ lineNo: 2, skuCode: '   ' })], 'Line 2: SKU code is required')
  refuses([line({ skuCode: undefined })], 'Line 1: SKU code is required')
})

test('quantity must be a whole number from 1 to the maximum', () => {
  const msg = `Line 1: quantity must be a whole number from 1 to ${MAX_PO_LINE_QUANTITY}`
  for (const qtyOrdered of [undefined, null, 0, -5, 2.5, '10', Number.NaN, MAX_PO_LINE_QUANTITY + 1]) {
    refuses([line({ qtyOrdered })], msg)
  }
  assertValidPurchaseOrderLines([line({ qtyOrdered: MAX_PO_LINE_QUANTITY })])
})

test('the same SKU on two lines is refused, pointing at the first', () => {
  refuses(
    [line(), line({ lineNo: 2, skuCode: ' COLA-12 ' })],
    'Line 2: SKU COLA-12 is already on line 1; change the quantity there instead',
  )
})

test('duplicate or invalid line numbers and a negative unit cost are refused', () => {
  refuses([line(), line({ skuCode: 'CHIPS-6' })], 'Line 1: duplicate line number')
  refuses([line({ lineNo: 0 })], 'Line 1: line number must be a whole number of 1 or more')
  refuses([line({ unitCost: -1 })], 'Line 1: unit cost must be a number of 0 or more')
  refuses([line({ description: 42 })], 'Line 1: description must be text')
})
