import assert from 'node:assert/strict'
import test from 'node:test'
import { marketplaceListingReservationOrderId } from './marketplace-inventory'

test('marketplaceListingReservationOrderId is stable per listing', () => {
  assert.equal(marketplaceListingReservationOrderId('lst_abc'), 'mp-listing-lst_abc')
})
