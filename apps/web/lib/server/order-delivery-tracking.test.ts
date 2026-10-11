import assert from 'node:assert/strict'
import test from 'node:test'
import { findOrderDelivery, type TrackingRoute } from './order-delivery-tracking'

const PHOTO = 'data:image/jpeg;base64,AAAA'
const SIGNATURE = 'data:image/png;base64,BBBB'

function route(over: Partial<TrackingRoute> & Pick<TrackingRoute, 'id' | 'status' | 'stops'>): TrackingRoute {
  return { scheduledFor: new Date('2026-10-02T15:00:00Z'), createdAt: new Date('2026-10-02T12:00:00Z'), ...over }
}

const delivered = {
  sequence: 1,
  status: 'DELIVERED',
  address: { orderId: 'ord_1' },
  pod: { photoUrl: PHOTO, signatureDataUrl: SIGNATURE, deliveredAt: '2026-10-02T23:15:31.262Z', notes: 'gate code 1234' },
}

test('findOrderDelivery finds a delivered stop on a COMPLETED route', () => {
  // The single-stop case from the live audit: delivering the stop completes the route.
  const d = findOrderDelivery([route({ id: 'r1', status: 'COMPLETED', stops: [delivered] })], 'ord_1')
  assert.ok(d)
  assert.equal(d.routeStatus, 'COMPLETED')
  assert.equal(d.stopStatus, 'DELIVERED')
  assert.equal(d.podPhotoUrl, PHOTO)
  assert.equal(d.deliveredAt, '2026-10-02T23:15:31.262Z')
  assert.equal(d.eta, null)
})

test('findOrderDelivery finds a delivered stop on a route still IN_PROGRESS', () => {
  const pending = { sequence: 2, status: 'PENDING', address: { orderId: 'ord_2' }, pod: null }
  const d = findOrderDelivery([route({ id: 'r1', status: 'IN_PROGRESS', stops: [delivered, pending] })], 'ord_1')
  assert.equal(d?.podPhotoUrl, PHOTO)
})

test('findOrderDelivery gives an ETA only for a stop still to come', () => {
  const pending = { sequence: 3, status: 'PENDING', address: { orderId: 'ord_1' }, pod: null }
  const d = findOrderDelivery([route({ id: 'r1', status: 'IN_PROGRESS', stops: [pending] })], 'ord_1')
  assert.equal(d?.eta?.toISOString(), '2026-10-02T16:30:00.000Z')
  assert.equal(d?.deliveredAt, null)
  assert.equal(d?.podPhotoUrl, null)
})

test('findOrderDelivery prefers the newest route when an order was re-routed', () => {
  const failed = { sequence: 1, status: 'FAILED', address: { orderId: 'ord_1' }, pod: null }
  const d = findOrderDelivery(
    [
      route({ id: 'first-attempt', status: 'COMPLETED', createdAt: new Date('2026-10-01T09:00:00Z'), stops: [failed] }),
      route({ id: 'redelivery', status: 'COMPLETED', createdAt: new Date('2026-10-02T09:00:00Z'), stops: [delivered] }),
    ],
    'ord_1',
  )
  assert.equal(d?.routeId, 'redelivery')
  assert.equal(d?.stopStatus, 'DELIVERED')
})

test('findOrderDelivery ignores CANCELLED routes and unrelated orders', () => {
  assert.equal(findOrderDelivery([route({ id: 'r1', status: 'CANCELLED', stops: [delivered] })], 'ord_1'), null)
  assert.equal(findOrderDelivery([route({ id: 'r1', status: 'COMPLETED', stops: [delivered] })], 'ord_other'), null)
})

test('findOrderDelivery never exposes the signature, notes or a malformed pod', () => {
  const d = findOrderDelivery([route({ id: 'r1', status: 'COMPLETED', stops: [delivered] })], 'ord_1')
  assert.ok(d)
  assert.ok(!JSON.stringify(d).includes(SIGNATURE))
  assert.ok(!JSON.stringify(d).includes('gate code'))

  const bad = { ...delivered, pod: ['not', 'an', 'object'] }
  const d2 = findOrderDelivery([route({ id: 'r1', status: 'COMPLETED', stops: [bad] })], 'ord_1')
  assert.equal(d2?.podPhotoUrl, null)
  assert.equal(d2?.deliveredAt, null)
})
