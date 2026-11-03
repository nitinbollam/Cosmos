import assert from 'node:assert/strict'
import { test } from 'node:test'
import { centsToAmount, formatAmount, sumAmounts, toCents } from './bank-recon-money'

test('amount strings convert to exact cents', () => {
  assert.equal(toCents('123.45'), 12345n)
  assert.equal(toCents('-0.5'), -50n)
  assert.equal(toCents('12'), 1200n)
  assert.equal(toCents('+7.07'), 707n)
  assert.throws(() => toCents('1.234'))
  assert.throws(() => toCents('abc'))
  assert.throws(() => toCents('1e3'))
})

test('sums are exact where floats are not', () => {
  assert.equal(0.1 + 0.2 === 0.3, false)
  assert.equal(sumAmounts(['0.10', '0.20']), '0.30')
  assert.equal(sumAmounts(['40.00', '60.00', '-100.00']), '0.00')
  assert.equal(sumAmounts([]), '0.00')
  assert.equal(centsToAmount(-5n), '-0.05')
})

test('display formatting keeps sign and grouping', () => {
  assert.equal(formatAmount('1234567.80'), '$1,234,567.80')
  assert.equal(formatAmount('-32.50'), '-$32.50')
  assert.equal(formatAmount('0.00'), '$0.00')
  assert.equal(formatAmount('5.00', 'EUR'), 'EUR 5.00')
})
