import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyAntiSnipeExtension,
  computeMinBidIncrementCents,
  computeMinimumNextBidCents,
  rankAuctionCandidates,
  reserveMet,
} from './marketplace-auctions'
import { MARKETPLACE_AUCTION_ANTI_SNIPE_MINUTES } from './marketplace-constants'

test('computeMinBidIncrementCents scales with price tier', () => {
  assert.equal(computeMinBidIncrementCents(50), 5)
  assert.equal(computeMinBidIncrementCents(1000), 50)
  assert.equal(computeMinBidIncrementCents(100000), 500)
})

test('computeMinimumNextBidCents uses starting price when no bids', () => {
  assert.equal(computeMinimumNextBidCents(5000, null), 5000)
  assert.equal(computeMinimumNextBidCents(5000, 5500), 5600)
})

test('reserveMet respects hidden reserve', () => {
  assert.equal(reserveMet(null, 10000), false)
  assert.equal(reserveMet(9999, 10000), false)
  assert.equal(reserveMet(10000, 10000), true)
  assert.equal(reserveMet(5000, null), true)
})

test('rankAuctionCandidates dedupes bidders and respects reserve', () => {
  const ranked = rankAuctionCandidates(
    [
      { bidderTenantId: 'a', amountCents: 5000 },
      { bidderTenantId: 'b', amountCents: 6000 },
      { bidderTenantId: 'a', amountCents: 5500 },
      { bidderTenantId: 'c', amountCents: 4000 },
    ],
    5000,
  )
  assert.equal(ranked.length, 2)
  assert.equal(ranked[0]?.bidderTenantId, 'b')
  assert.equal(ranked[0]?.amountCents, 6000)
  assert.equal(ranked[1]?.bidderTenantId, 'a')
})

test('applyAntiSnipeExtension extends ending within snipe window', () => {
  const now = new Date('2026-06-01T12:00:00Z')
  const endsSoon = new Date('2026-06-01T12:03:00Z')
  const extended = applyAntiSnipeExtension(endsSoon, now)
  assert.equal(
    extended.getTime(),
    now.getTime() + MARKETPLACE_AUCTION_ANTI_SNIPE_MINUTES * 60 * 1000,
  )
  const endsLater = new Date('2026-06-01T13:00:00Z')
  assert.equal(applyAntiSnipeExtension(endsLater, now).getTime(), endsLater.getTime())
})
