import assert from 'node:assert/strict'
import test from 'node:test'
import { assertRouteVisible, driverFilter, driverMayCallRoutes, isDriverRole, parseDriverLocation } from './driver-scope'

test('only the DRIVER role is scoped to its own routes', () => {
  assert.equal(isDriverRole('DRIVER'), true)
  assert.equal(isDriverRole('driver'), true)
  for (const r of ['MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN', 'WAREHOUSE_STAFF', 'SALES_REP', '']) {
    assert.equal(isDriverRole(r), false, r)
  }
  assert.equal(driverFilter({ role: 'DRIVER', userId: 'u1' }), 'u1')
  assert.equal(driverFilter({ role: 'MANAGER', userId: 'u2' }), undefined)
})

test('a driver cannot see a route that is not theirs, and the answer is 404', () => {
  assert.doesNotThrow(() => assertRouteVisible({ role: 'DRIVER', userId: 'u1' }, { driverId: 'u1' }))
  for (const route of [{ driverId: 'u2' }, { driverId: null }, {}]) {
    assert.throws(() => assertRouteVisible({ role: 'DRIVER', userId: 'u1' }, route), (e: { status?: number }) => e.status === 404)
  }
  assert.doesNotThrow(() => assertRouteVisible({ role: 'MANAGER', userId: 'm' }, { driverId: 'u2' }))
})

test('drivers may list, open, and record stop outcomes; nothing that plans routes', () => {
  assert.equal(driverMayCallRoutes('GET', ['routes']), true)
  assert.equal(driverMayCallRoutes('GET', ['routes', 'r1']), true)
  assert.equal(driverMayCallRoutes('POST', ['routes', 'r1', 'stops', 's1', 'delivered']), true)
  assert.equal(driverMayCallRoutes('POST', ['routes', 'r1', 'stops', 's1', 'failed']), true)
  assert.equal(driverMayCallRoutes('GET', ['routes', 'shipped-orders']), false)
  assert.equal(driverMayCallRoutes('POST', ['routes']), false)
  assert.equal(driverMayCallRoutes('POST', ['routes', 'from-orders']), false)
  assert.equal(driverMayCallRoutes('PATCH', ['routes', 'r1', 'driver']), false)
  assert.equal(driverMayCallRoutes('DELETE', ['routes', 'r1', 'driver']), false)
  assert.equal(driverMayCallRoutes('PATCH', ['routes', 'r1', 'stops', 'reorder']), false)
  assert.equal(driverMayCallRoutes('POST', ['routes', 'r1', 'optimize']), false)
})

test('location pings need a route and a real fix', () => {
  const ok = parseDriverLocation({ routeId: 'r1', lat: 27.95, lng: -82.46 })
  assert.equal(ok.routeId, 'r1')
  assert.equal(ok.lat, 27.95)
  for (const bad of [
    {},
    { lat: 27.9, lng: -82.4 },
    { routeId: 'r1', lat: 0, lng: 0 },
    { routeId: 'r1', lat: 91, lng: 0.1 },
    { routeId: 'r1', lat: 10, lng: 181 },
    { routeId: 'r1', lat: 'x', lng: 1 },
    { routeId: 'r1', latitude: 27.9, longitude: -82.4 },
    { routeId: 'r1', lat: 27.9, lng: -82.4, timestamp: 'not a date' },
  ]) {
    assert.throws(() => parseDriverLocation(bad), (e: { status?: number }) => e.status === 400, JSON.stringify(bad))
  }
})

test('a device clock in the future cannot pin the last-seen time', () => {
  const now = new Date('2026-10-21T12:00:00Z')
  const fut = parseDriverLocation({ routeId: 'r', lat: 1, lng: 1, timestamp: '2026-10-25T00:00:00Z' }, now)
  assert.equal(fut.timestamp.getTime(), now.getTime())
  const past = parseDriverLocation({ routeId: 'r', lat: 1, lng: 1, timestamp: '2026-10-21T11:59:00Z' }, now)
  assert.equal(past.timestamp.toISOString(), '2026-10-21T11:59:00.000Z')
})
