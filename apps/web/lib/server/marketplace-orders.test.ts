import assert from 'node:assert/strict'
import test from 'node:test'
import { toPublicOrder } from './marketplace-orders'
import { computeMarketplaceCommission, MARKETPLACE_COMMISSION_RATE } from './marketplace-constants'

test('computeMarketplaceCommission uses placeholder rate', () => {
  assert.equal(computeMarketplaceCommission(10_000), Math.round(10_000 * MARKETPLACE_COMMISSION_RATE))
})

test('public order payload excludes tenant identity', () => {
  const pub = toPublicOrder({
    id: 'ord-1',
    listingId: 'lst-1',
    agreedPriceCents: 5000,
    quantity: 2,
    orderStatus: 'PAYMENT_HELD',
    paymentStatus: 'ESCROW_HELD',
    kalafleetShipmentRef: 'KF-12345',
    createdAt: new Date('2026-01-15T12:00:00Z'),
  })

  assert.equal(pub.id, 'ord-1')
  assert.equal(pub.kalafleetShipmentRef, 'KF-12345')
  assert.equal(pub.trackingOnly, true)
  assert.equal('buyerTenantId' in pub, false)
  assert.equal('sellerTenantId' in pub, false)
})
