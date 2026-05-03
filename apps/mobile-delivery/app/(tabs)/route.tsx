import React, { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native'
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps'
import * as Location from 'expo-location'
import { useRouter } from 'expo-router'
import NetInfo from '@react-native-community/netinfo'
import { useRouteStore } from '../../src/stores/route.store'
import { dispatchClient } from '../../src/api/dispatch.client'
import { syncService } from '../../src/sync/sync.service'
import { useAuthStore } from '../../src/stores/auth.store'

export default function RouteScreen() {
  const stops = useRouteStore((s) => s.stops)
  const currentStopIndex = useRouteStore((s) => s.currentStopIndex)
  const routeId = useRouteStore((s) => s.routeId)
  const seedDemoRoute = useRouteStore((s) => s.seedDemoRoute)
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const mapRef = useRef<MapView>(null)
  const router = useRouter()
  const { token, tenantId } = useAuthStore()

  useEffect(() => {
    if (!stops.length && !routeId) seedDemoRoute()
  }, [stops.length, routeId, seedDemoRoute])

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null
    const start = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Location improves navigation — you can dismiss for dry runs.')
        return
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 50 },
        async ({ coords }) => {
          setDriverLocation({ latitude: coords.latitude, longitude: coords.longitude })
          const payload = {
            lat: coords.latitude,
            lng: coords.longitude,
            timestamp: new Date().toISOString(),
          }
          const net = await NetInfo.fetch()
          if (net.isConnected) {
            dispatchClient.updateDriverLocation(token, tenantId, payload).catch(() => undefined)
          } else {
            void syncService.queueAction('driver_location', payload)
          }
        },
      )
    }
    void start()
    return () => {
      sub?.remove()
    }
  }, [token, tenantId])

  const currentStop = stops[currentStopIndex]

  return (
    <View style={s.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={s.map}
        showsUserLocation
        followsUserLocation
      >
        {stops.map((stop, i) => (
          <Marker
            key={stop.id}
            coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
            pinColor={
              i === currentStopIndex ? '#6366F1' : i < currentStopIndex ? '#22C55E' : '#64748B'
            }
            title={`Stop ${i + 1}: ${stop.customerName}`}
          />
        ))}
        {driverLocation && currentStop && (
          <Polyline
            coordinates={[
              driverLocation,
              { latitude: currentStop.latitude, longitude: currentStop.longitude },
            ]}
            strokeColor="#6366F1"
            strokeWidth={3}
          />
        )}
      </MapView>

      <View style={s.panel}>
        {currentStop ? (
          <>
            <Text style={s.stopLabel}>
              Stop {currentStopIndex + 1} of {stops.length}
            </Text>
            <Text style={s.name}>{currentStop.customerName}</Text>
            <Text style={s.address}>{currentStop.address}</Text>
            <Text style={s.order}>
              {currentStop.packageCount} packages · #{currentStop.orderId.slice(-8)}
            </Text>

            <View style={s.actions}>
              <TouchableOpacity
                style={[s.btn, s.delivered]}
                onPress={() =>
                  router.push(
                    `/delivery/pod/${encodeURIComponent(currentStop.id)}?routeId=${encodeURIComponent(currentStop.routeId)}`,
                  )
                }
              >
                <Text style={s.btnText}>Proof of delivery</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, s.failed]}
                onPress={() =>
                  router.push(
                    `/delivery/failed/${currentStop.id}?routeId=${encodeURIComponent(currentStop.routeId)}`,
                  )
                }
              >
                <Text style={s.btnText}>Issue</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={s.done}>
            <Text style={s.doneText}>Route Complete</Text>
            <Text style={s.doneSub}>All {stops.length} deliveries done</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  panel: {
    backgroundColor: '#0A0A0F',
    padding: 20,
    paddingBottom: 40,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    minHeight: 220,
  },
  stopLabel: {
    color: '#6366F1',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  name: { color: '#E2E8F0', fontSize: 20, fontWeight: '700', marginTop: 4 },
  address: { color: '#94A3B8', fontSize: 14, marginTop: 4 },
  order: { color: '#64748B', fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  delivered: { backgroundColor: '#16A34A' },
  failed: { backgroundColor: '#DC2626' },
  btnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  done: { alignItems: 'center', paddingVertical: 20 },
  doneText: { color: '#E2E8F0', fontSize: 24, fontWeight: '700' },
  doneSub: { color: '#94A3B8', fontSize: 14, marginTop: 8 },
})
