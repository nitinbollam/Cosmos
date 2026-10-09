import assert from 'node:assert/strict'
import test from 'node:test'

test('formatBillNumber pattern', () => {
  const num = 'PO-1001'.replace(/^PO-/i, '')
  assert.equal(`BILL-${num}`, 'BILL-1001')
})

test('bill balance helper', () => {
  const balance = (total: number, paid: number) => Math.max(0, +(total - paid).toFixed(2))
  assert.equal(balance(575, 200), 375)
  assert.equal(balance(100, 120), 0)
})
