import assert from 'node:assert/strict'
import test from 'node:test'
import { applyOverrides } from './feature-flags'
import { assertValidOrderLines } from './orders'

const line = (quantity: unknown, unitPrice: unknown = 10) => ({
  skuId: 'sku',
  warehouseId: 'wh',
  quantity,
  unitPrice,
})

test('order lines must be whole, positive quantities at non-negative prices', () => {
  assert.doesNotThrow(() => assertValidOrderLines([line(1), line(250, 0)]))
  for (const bad of [
    [line(-10)],
    [line(0)],
    [line(2.5)],
    [line('3')],
    [line(5_000_000)],
    [line(1, -45)],
    [line(1, Number.NaN)],
    [],
    'not an array',
  ]) {
    assert.throws(() => assertValidOrderLines(bad), { status: 400 }, JSON.stringify(bad))
  }
})

test('a negative line can no longer zero out real goods', () => {
  // 7 × $45 offset by −10 × $31.50 used to total $0 and ship for free.
  assert.throws(() => assertValidOrderLines([line(7, 45), line(-10, 31.5)]), { status: 400 })
})

test('workspace overrides can switch plan features off but never on', () => {
  const starter = { pos: false, quotes: true, celestial: false }
  assert.deepEqual(applyOverrides(starter, { pos: true, celestial: true }), {
    pos: false,
    quotes: true,
    celestial: false,
  })
  assert.deepEqual(applyOverrides(starter, { quotes: false }), { pos: false, quotes: false, celestial: false })
})

test('rate limits key on the IP our proxy saw, not one the caller made up', async () => {
  const { clientIp } = await import('./auth-security')
  const req = (xff: string) => new Request('http://x/', { headers: { 'x-forwarded-for': xff } })
  // Caller sends a fake first entry; Render appends the real address at the end.
  assert.equal(clientIp(req('6.6.6.6, 203.0.113.9')), '203.0.113.9')
  assert.equal(clientIp(req('1.1.1.1, 2.2.2.2, 203.0.113.9')), '203.0.113.9')
  assert.equal(clientIp(req('203.0.113.9')), '203.0.113.9')
})
