import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupRoutes, navigationUrl, nextStop, routeProgress, routeSummary, stopLabel, telUrl } from './driver-routes'

const now = new Date(2026, 9, 21, 9, 0, 0)
const at = (d: number, h = 8) => new Date(2026, 9, d, h, 0, 0).toISOString()

test('routes are grouped into today, later and earlier; a route under way stays today', () => {
  const g = groupRoutes(
    [
      { id: 'a', status: 'ASSIGNED', scheduledFor: at(21, 14) },
      { id: 'b', status: 'ASSIGNED', scheduledFor: at(22) },
      { id: 'c', status: 'ASSIGNED', scheduledFor: at(19) },
      { id: 'd', status: 'IN_PROGRESS', scheduledFor: at(20) },
      { id: 'e', status: 'ASSIGNED', scheduledFor: at(21, 7) },
      { id: 'f', status: 'ASSIGNED' },
    ],
    now,
  )
  assert.deepEqual(g.today.map((r) => r.id), ['d', 'e', 'a', 'f'])
  assert.deepEqual(g.later.map((r) => r.id), ['b'])
  assert.deepEqual(g.earlier.map((r) => r.id), ['c'])
})

test('progress counts delivered and failed stops as done', () => {
  const r = { id: 'r', status: 'IN_PROGRESS', stops: [
    { id: '1', sequence: 1, status: 'DELIVERED' },
    { id: '2', sequence: 2, status: 'FAILED' },
    { id: '3', sequence: 3, status: 'PENDING' },
    { id: '4', sequence: 4, status: 'PENDING' },
  ] }
  assert.deepEqual(routeProgress(r), { total: 4, delivered: 1, failed: 1, remaining: 2, percent: 50 })
  assert.equal(routeProgress({ id: 'x', status: 'ASSIGNED' }).percent, 0)
})

test('the next stop is the first one in sequence without an outcome', () => {
  const r = { id: 'r', status: 'IN_PROGRESS', stops: [
    { id: '3', sequence: 3, status: 'PENDING' },
    { id: '1', sequence: 1, status: 'DELIVERED' },
    { id: '2', sequence: 2, status: 'EN_ROUTE' },
  ] }
  assert.equal(nextStop(r)?.id, '2')
  assert.equal(nextStop({ id: 'r', status: 'COMPLETED', stops: [{ id: '1', sequence: 1, status: 'FAILED' }] }), null)
})

test('stop labels and navigation links', () => {
  const addr = { customer: 'Acme', line1: '1 Main St', city: 'Tampa', state: 'FL', postalCode: '33602' }
  assert.deepEqual(stopLabel(addr), { who: 'Acme', where: '1 Main St, Tampa, FL 33602' })
  assert.match(navigationUrl(addr) ?? '', /destination=1%20Main%20St%2C%20Tampa%2C%20FL%2033602$/)
  assert.match(navigationUrl({ ...addr, lat: 27.95, lng: -82.46 }) ?? '', /destination=27\.95,-82\.46$/)
  assert.match(navigationUrl({ ...addr, lat: 0, lng: 0 }) ?? '', /destination=1%20Main/)
  assert.equal(navigationUrl({}), null)
})

test('phone links need enough digits to dial', () => {
  assert.equal(telUrl('(813) 555-0100'), 'tel:8135550100')
  assert.equal(telUrl('+1 813 555 0100'), 'tel:+18135550100')
  assert.equal(telUrl('555'), null)
  assert.equal(telUrl(null), null)
})

test('the end-of-route summary reports outcomes and elapsed minutes', () => {
  const s = routeSummary({ id: 'r', status: 'COMPLETED', stops: [
    { id: '1', sequence: 1, status: 'DELIVERED', pod: { deliveredAt: '2026-10-21T09:00:00Z' } },
    { id: '2', sequence: 2, status: 'FAILED', pod: { failure: { failedAt: '2026-10-21T10:30:00Z' } } },
  ] })
  assert.deepEqual(s, { delivered: 1, failed: 1, minutes: 90 })
  assert.equal(routeSummary({ id: 'r', status: 'COMPLETED', stops: [{ id: '1', sequence: 1, status: 'DELIVERED' }] }).minutes, null)
})
