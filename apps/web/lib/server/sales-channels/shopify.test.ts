import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it, before, after } from 'node:test'
import { verifyShopifyWebhookHmac } from './shopify'

describe('verifyShopifyWebhookHmac', () => {
  const prevSecret = process.env.SHOPIFY_CLIENT_SECRET

  before(() => {
    process.env.SHOPIFY_CLIENT_SECRET = 'test-shopify-secret'
  })

  after(() => {
    if (prevSecret === undefined) delete process.env.SHOPIFY_CLIENT_SECRET
    else process.env.SHOPIFY_CLIENT_SECRET = prevSecret
  })

  it('accepts a valid HMAC-SHA256 base64 signature', () => {
    const body = Buffer.from('{"id":123}')
    const hmac = createHmac('sha256', 'test-shopify-secret').update(body).digest('base64')
    assert.doesNotThrow(() => verifyShopifyWebhookHmac(body, hmac))
  })

  it('rejects an invalid signature', () => {
    const body = Buffer.from('{"id":123}')
    assert.throws(() => verifyShopifyWebhookHmac(body, 'invalid'), /Invalid Shopify webhook signature/)
  })
})
