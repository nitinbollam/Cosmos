import assert from 'node:assert/strict'
import test from 'node:test'
import { overReceiptProblem, scanOverReceiptProblem } from './po-receiving'

const line = { qtyOrdered: 10, qtyReceived: 0 }

test('units within what the PO has open are allowed', () => {
  assert.equal(overReceiptProblem('PO-1001', 'ACC-CBL-USB', line, 1), null)
  assert.equal(overReceiptProblem('PO-1001', 'ACC-CBL-USB', line, 10), null)
})

test('one unit more than the PO has open is refused, with the number still open', () => {
  assert.equal(
    overReceiptProblem('PO-1001', 'ACC-CBL-USB', line, 11),
    'PO-1001 has only 10 more ACC-CBL-USB to receive, not 11',
  )
})

test('earlier receipts on the PO count against what is open', () => {
  const partly = { qtyOrdered: 10, qtyReceived: 8 }
  assert.equal(overReceiptProblem('PO-1001', 'ACC-CBL-USB', partly, 2), null)
  assert.equal(
    overReceiptProblem('PO-1001', 'ACC-CBL-USB', partly, 3),
    'PO-1001 has only 2 more ACC-CBL-USB to receive, not 3',
  )
})

test('a fully received line refuses any more', () => {
  assert.equal(
    overReceiptProblem('PO-1001', 'ACC-CBL-USB', { qtyOrdered: 10, qtyReceived: 10 }, 1),
    'PO-1001 has no more ACC-CBL-USB to receive',
  )
})

test('a product that is not on the PO is refused', () => {
  assert.equal(overReceiptProblem('PO-1001', 'BEV-COLA-12', undefined, 1), "BEV-COLA-12 isn't on PO-1001")
})

test('a scan that does not fit says how many more can be added, counting what is already scanned', () => {
  const line = { qtyOrdered: 20, qtyReceived: 0 }
  assert.equal(scanOverReceiptProblem('PO-1001', 'OFF-PEN-100', line, 8, 12), null)
  assert.equal(
    scanOverReceiptProblem('PO-1001', 'OFF-PEN-100', line, 8, 50),
    'PO-1001 ordered 20 OFF-PEN-100; 8 already received or scanned, so only 12 more can be added (you tried to add 50)',
  )
})

test('units already received on the PO count too', () => {
  const line = { qtyOrdered: 20, qtyReceived: 15 }
  assert.equal(scanOverReceiptProblem('PO-1001', 'OFF-PEN-100', line, 2, 3), null)
  assert.equal(
    scanOverReceiptProblem('PO-1001', 'OFF-PEN-100', line, 2, 4),
    'PO-1001 ordered 20 OFF-PEN-100; 17 already received or scanned, so only 3 more can be added (you tried to add 4)',
  )
})

test('a scan on a line with nothing left, or a SKU that is not on the PO, is refused plainly', () => {
  assert.equal(
    scanOverReceiptProblem('PO-1001', 'OFF-PEN-100', { qtyOrdered: 20, qtyReceived: 12 }, 8, 1),
    'PO-1001 has no more OFF-PEN-100 to receive: 20 ordered, 20 already received or scanned',
  )
  assert.equal(scanOverReceiptProblem('PO-1001', 'BEV-COLA-12', undefined, 0, 1), "BEV-COLA-12 isn't on PO-1001")
})
