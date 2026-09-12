import assert from 'node:assert/strict'
import test from 'node:test'
import { marketplaceListingReservationOrderId } from './marketplace-inventory'

test('marketplaceListingReservationOrderId is stable per listing', () => {
  assert.equal(marketplaceListingReservationOrderId('lst_abc'), 'mp-listing-lst_abc')
})

test('marketplaceListingReservationOrderId formats cleanly for numeric and UUID strings', () => {
  assert.equal(marketplaceListingReservationOrderId('12345'), 'mp-listing-12345')
  assert.equal(
    marketplaceListingReservationOrderId('cmtxomfwr00021n6k4tuai8w9'),
    'mp-listing-cmtxomfwr00021n6k4tuai8w9',
  )
})
