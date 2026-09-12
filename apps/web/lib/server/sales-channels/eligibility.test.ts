import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isChannelEligible } from './eligibility'

const regulatedSku = {
  isActive: true,
  isTobacco: true,
  isAlcohol: false,
  isRegulated: true,
}

const alcoholSku = {
  isActive: true,
  isTobacco: false,
  isAlcohol: true,
  isRegulated: false,
}

const generalSku = {
  isActive: true,
  isTobacco: false,
  isAlcohol: false,
  isRegulated: false,
}

const inactiveSku = {
  isActive: false,
  isTobacco: false,
  isAlcohol: false,
  isRegulated: false,
}

describe('isChannelEligible', () => {
  it('allows regulated SKUs on SHOPIFY', () => {
    assert.equal(isChannelEligible(regulatedSku, 'SHOPIFY'), true)
    assert.equal(isChannelEligible(alcoholSku, 'SHOPIFY'), true)
  })

  it('blocks regulated SKUs on marketplace channels', () => {
    for (const channel of ['AMAZON', 'EBAY', 'WALMART'] as const) {
      assert.equal(isChannelEligible(regulatedSku, channel), false)
      assert.equal(isChannelEligible(alcoholSku, channel), false)
    }
  })

  it('allows general merchandise on all channel types when active', () => {
    for (const channel of ['SHOPIFY', 'AMAZON', 'EBAY', 'WALMART'] as const) {
      assert.equal(isChannelEligible(generalSku, channel), true)
    }
  })

  it('blocks inactive SKUs on every channel', () => {
    for (const channel of ['SHOPIFY', 'AMAZON', 'EBAY', 'WALMART'] as const) {
      assert.equal(isChannelEligible(inactiveSku, channel), false)
    }
  })
})
