import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeMarketplaceTransferCents,
  marketplaceApplicationFeeCents,
} from './marketplace-payments'
import { MARKETPLACE_COMMISSION_RATE } from './marketplace-constants'

test('marketplaceApplicationFeeCents uses placeholder commission rate', () => {
  assert.equal(marketplaceApplicationFeeCents(10_000), Math.round(10_000 * MARKETPLACE_COMMISSION_RATE))
})

test('computeMarketplaceTransferCents is gross minus commission', () => {
  const gross = 25_000
  assert.equal(
    computeMarketplaceTransferCents(gross),
    gross - Math.round(gross * MARKETPLACE_COMMISSION_RATE),
  )
})
