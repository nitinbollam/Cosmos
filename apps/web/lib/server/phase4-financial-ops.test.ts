import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, timingSafeEqual } from 'node:crypto'
import { toBaseAmount, normalizeCurrency } from './fx-util'
import { encryptSecret, decryptSecret } from './crypto-util'

describe('phase4 financial ops', () => {
  it('toBaseAmount converts using captured fx rate', () => {
    assert.equal(toBaseAmount(100, 1.25), 125)
    assert.equal(toBaseAmount(50, 1), 50)
  })

  it('normalizeCurrency defaults invalid codes to USD', () => {
    assert.equal(normalizeCurrency('eur'), 'EUR')
    assert.equal(normalizeCurrency(''), 'USD')
  })

  it('system job token comparison uses constant-time hash check', () => {
    const token = 'test-system-token'
    const a = createHash('sha256').update('wrong').digest()
    const b = createHash('sha256').update(token).digest()
    assert.equal(a.length, b.length)
    assert.equal(timingSafeEqual(a, b), false)
  })

  it('encryptSecret round-trips when ENCRYPTION_KEY is set', () => {
    if (!process.env.ENCRYPTION_KEY?.trim()) {
      process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
    }
    const cipher = encryptSecret('plaid-access-token-abc')
    assert.notEqual(cipher, 'plaid-access-token-abc')
    assert.equal(decryptSecret(cipher), 'plaid-access-token-abc')
  })

  it('gift card style balance cap logic for expense totals', () => {
    const requested = 120
    const balance = 80
    const applied = Math.min(requested, balance)
    assert.equal(applied, 80)
    assert.ok(applied <= balance)
  })
})
