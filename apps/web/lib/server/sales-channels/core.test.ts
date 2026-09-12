import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isChannelEligible } from './eligibility'

describe('sales channel core eligibility integration', () => {
  it('maps marketplace channels to regulated-goods exclusion', () => {
    const sku = { isActive: true, isTobacco: true, isAlcohol: false, isRegulated: true }
    assert.equal(isChannelEligible(sku, 'SHOPIFY'), true)
    assert.equal(isChannelEligible(sku, 'AMAZON'), false)
    assert.equal(isChannelEligible(sku, 'EBAY'), false)
    assert.equal(isChannelEligible(sku, 'WALMART'), false)
  })

  it('treats alcohol SKUs as ineligible on marketplace channels only', () => {
    const sku = { isActive: true, isTobacco: false, isAlcohol: true, isRegulated: false }
    assert.equal(isChannelEligible(sku, 'SHOPIFY'), true)
    assert.equal(isChannelEligible(sku, 'WALMART'), false)
  })
})
