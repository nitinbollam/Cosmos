import assert from 'node:assert/strict'
import test from 'node:test'
import { compareAmounts, formatAmount, lineAmount, parseAmountInput, sumAmounts, toScaled } from './decimal-amount'

test('typed amounts are validated and normalized without rounding', () => {
  assert.deepEqual(parseAmountInput('12.50'), { ok: true, value: '12.5' })
  assert.deepEqual(parseAmountInput(' .5 '), { ok: true, value: '0.5' })
  assert.deepEqual(parseAmountInput('0'), { ok: true, value: '0' })
  assert.deepEqual(parseAmountInput('4.2500'), { ok: true, value: '4.25' })
  assert.deepEqual(parseAmountInput('999999999.9999'), { ok: true, value: '999999999.9999' })
  for (const [bad, why] of [
    ['', /required/],
    ['-1', /0 or more/],
    ['1.23456', /at most 4 decimal/],
    ['1e3', /number like/],
    ['abc', /number like/],
    ['.', /number like/],
    ['1,000', /number like/],
    ['1000000000', /below/],
  ] as const) {
    const r = parseAmountInput(bad, 'Cost')
    assert.equal(r.ok, false, bad)
    if (!r.ok) assert.match(r.error, why, bad)
  }
})

test('arithmetic is exact where floats drift', () => {
  assert.equal(sumAmounts(['0.1', '0.2']), '0.3')
  assert.equal(lineAmount('0.3333', 3), '0.9999')
  assert.equal(lineAmount('4.25', 1000), '4250')
  assert.equal(sumAmounts([lineAmount('4.25', 1000), '12.5', null]), '4262.5')
  assert.equal(lineAmount('999999999.9999', 1_000_000), '999999999999900')
  assert.equal(compareAmounts('12.5', '12.50'), 0)
  assert.equal(compareAmounts('12.5001', '12.5'), 1)
})

test('API Decimal strings are read exactly; anything beyond 4 places is refused, not rounded', () => {
  assert.equal(toScaled('4.25'), 42500n)
  assert.equal(toScaled(12.5), 125000n)
  assert.equal(toScaled('4.250000'), 42500n, 'trailing zeros are fine')
  assert.throws(() => toScaled('4.25001'))
  assert.throws(() => toScaled('1e-7'))
})

test('display keeps every digit and pads to cents', () => {
  assert.equal(formatAmount('4262.5'), '$4,262.50')
  assert.equal(formatAmount('0.9999'), '$0.9999')
  assert.equal(formatAmount('1234567.1', 'EUR'), '1,234,567.10 EUR')
  assert.equal(formatAmount('0'), '$0.00')
  assert.equal(formatAmount('weird'), 'weird')
  assert.equal(formatAmount('4262.5', 'USD', { grouping: false }), '$4262.50')
  assert.equal(formatAmount('4.2525', 'USD', { grouping: false }), '$4.2525')
})
