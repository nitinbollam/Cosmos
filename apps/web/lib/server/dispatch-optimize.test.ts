import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { dispatchDb } from './db'
import {
  haversineDistance,
  extractStopCoords,
  optimizeRouteStopsNearestNeighbor,
} from './dispatch'
import { RouteStatus } from '@/generated/prisma-dispatch'

test('Haversine distance and coordinate extraction', () => {
  // Dallas to Fort Worth (~50 km)
  const dallas = { lat: 32.7767, lng: -96.797 }
  const fortWorth = { lat: 32.7555, lng: -97.3308 }

  const dist = haversineDistance(dallas.lat, dallas.lng, fortWorth.lat, fortWorth.lng)
  assert.ok(dist > 45 && dist < 55, `Expected ~50km, got ${dist}km`)

  const parsed = extractStopCoords({ lat: 32.7767, lng: -96.797 })
  assert.equal(parsed.lat, 32.7767)
  assert.equal(parsed.lng, -96.797)
})

test('Nearest-Neighbor Route Stop Optimization', async () => {
  const tenantId = `tenant-${randomUUID()}`

  // Create delivery route starting in Dallas
  const route = await dispatchDb.deliveryRoute.create({
    data: {
      id: randomUUID(),
      tenantId,
      name: 'North Texas Delivery Run',
      status: RouteStatus.PLANNED,
      lastKnownLat: 32.7767, // Starting point: Dallas Depot
      lastKnownLng: -96.797,
      stops: {
        create: [
          {
            sequence: 1,
            address: { line1: 'Far Stop - Fort Worth', lat: 32.7555, lng: -97.3308 },
          },
          {
            sequence: 2,
            address: { line1: 'Close Stop - Arlington', lat: 32.7357, lng: -97.1081 },
          },
          {
            sequence: 3,
            address: { line1: 'Closest Stop - Irving', lat: 32.814, lng: -96.9489 },
          },
        ],
      },
    },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  })

  // Optimize route using nearest-neighbor algorithm
  const optimized = await optimizeRouteStopsNearestNeighbor(tenantId, route.id)

  assert.equal(optimized.stops.length, 3)

  // Starting from Dallas (32.7767, -96.797):
  // 1st closest: Irving (32.814, -96.9489)
  // 2nd closest from Irving: Arlington (32.7357, -97.1081)
  // 3rd closest: Fort Worth (32.7555, -97.3308)
  const stopNames = optimized.stops.map((s) => (s.address as Record<string, string>).line1)
  assert.equal(stopNames[0], 'Closest Stop - Irving')
  assert.equal(stopNames[1], 'Close Stop - Arlington')
  assert.equal(stopNames[2], 'Far Stop - Fort Worth')
  assert.equal(optimized.stops[0]!.sequence, 1)
  assert.equal(optimized.stops[1]!.sequence, 2)
  assert.equal(optimized.stops[2]!.sequence, 3)
})
