import assert from 'node:assert/strict'
import test from 'node:test'
import { allocate, formatMoney, fromCents, fromFloat, money, percentOf, roundMoney, sum, toCents } from './money'

test('rounding is half away from zero at the half-cent boundary', () => {
  const cases: Array<[string, string]> = [
    ['0.004', '0.00'],
    ['0.005', '0.01'],
    ['0.015', '0.02'],
    ['1.005', '1.01'],
    ['2.675', '2.68'],
    ['-0.004', '0.00'],
    ['-0.005', '-0.01'],
    ['-1.005', '-1.01'],
  ]
  for (const [input, expected] of cases) assert.equal(roundMoney(input).toFixed(2), expected, input)
})

test('floats are converted through their shortest decimal form, not their binary expansion', () => {
  assert.equal(fromFloat(0.1 + 0.2).toFixed(2), '0.30')
  assert.equal(fromFloat(1.005).toFixed(2), '1.01')
  assert.equal(fromFloat(19.99 * 3).toFixed(2), '59.97')
  assert.throws(() => fromFloat(Number.NaN))
  assert.throws(() => fromFloat(Infinity))
})

test('cents round trip and large amounts stay exact', () => {
  assert.equal(toCents('19.99'), 1999)
  assert.equal(toCents('-0.01'), -1)
  assert.equal(fromCents(1999).toFixed(2), '19.99')
  assert.equal(formatMoney(fromCents(9_999_999_999_999_99n)), '9999999999999.99')
  assert.equal(toCents('9999999999999.99'), 999_999_999_999_999)
  assert.throws(() => toCents('99999999999999999.99'))
  assert.throws(() => fromCents(1.5))
})

test('sum is exact where floating point is not', () => {
  assert.equal(sum(['0.1', '0.2']).toFixed(2), '0.30')
  assert.equal(sum(Array.from({ length: 1000 }, () => '0.01')).toFixed(2), '10.00')
  assert.equal(0.1 + 0.2 === 0.3, false, 'the reason this module exists')
})

test('percentOf rounds once at the end', () => {
  assert.equal(percentOf('9.99', '0.07').toFixed(2), '0.70')
  assert.equal(percentOf('100.00', '0.0725').toFixed(2), '7.25')
  assert.equal(percentOf('0.07', '0.5').toFixed(2), '0.04')
})

test('money() rejects things that are not amounts', () => {
  assert.throws(() => money('abc'))
  assert.throws(() => money('Infinity'))
  assert.equal(money('12.5').toFixed(2), '12.50')
})

test('allocate: the classic cases', () => {
  assert.deepEqual(allocate('100.00', ['1', '1', '1']).map(String), ['33.34', '33.33', '33.33'])
  // 1.5 and 3.5 cents: the tie goes to the earlier weight.
  assert.deepEqual(allocate('0.05', ['3', '7']).map((d) => d.toFixed(2)), ['0.02', '0.03'])
  assert.deepEqual(allocate('-100.00', ['1', '1', '1']).map((d) => d.toFixed(2)), ['-33.34', '-33.33', '-33.33'])
  assert.deepEqual(allocate('10.00', ['0', '5']).map((d) => d.toFixed(2)), ['0.00', '10.00'])
  assert.throws(() => allocate('1.00', []))
  assert.throws(() => allocate('1.00', ['0', '0']))
  assert.throws(() => allocate('1.00', ['-1', '2']))
})

test('property: allocate always sums exactly to the total and never differs from the ideal share by a cent', () => {
  let seed = 987654321
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 3000; i++) {
    const total = (Math.round((rnd() - 0.3) * 2_000_000) / 100).toFixed(2)
    const n = 1 + Math.floor(rnd() * 8)
    const weights: string[] = Array.from({ length: n }, () => String(Math.floor(rnd() * 100)))
    if (weights.filter((w) => w !== '0').length === 0) weights[0] = '1'
    const parts = allocate(total, weights)
    assert.equal(sum(parts).toFixed(2), formatMoney(total), `${total} over ${weights.join(',')}`)
    const wsum = weights.reduce((a, b) => a + Number(b), 0)
    parts.forEach((p, idx) => {
      const ideal = (Number(total) * Number(weights[idx])) / wsum
      assert.ok(Math.abs(Number(p.toFixed(2)) - ideal) < 0.0101, `part ${idx} of ${total}`)
    })
  }
})

test('property: an invoice built line by line equals the sum of its parts to the cent', () => {
  let seed = 424242
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 2000; i++) {
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => ({
      qty: 1 + Math.floor(rnd() * 50),
      price: (Math.round(rnd() * 99999) / 100).toFixed(2),
    }))
    const rate = (Math.round(rnd() * 1200) / 10000).toFixed(4)
    const subtotal = sum(lines.map((l) => roundMoney(money(l.price).times(l.qty))))
    const tax = percentOf(subtotal, rate)
    const total = subtotal.plus(tax)
    const debit = total
    const credit = subtotal.plus(tax)
    assert.equal(debit.toFixed(2), credit.toFixed(2))
    assert.equal(toCents(total), toCents(subtotal) + toCents(tax))
  }
})
