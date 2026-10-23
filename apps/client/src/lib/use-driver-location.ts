import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api-mobile'

export type LocationState = 'idle' | 'sharing' | 'denied' | 'unsupported' | 'error'

const PING_MS = 30_000

/**
 * Shares the driver's real position with dispatch while they have an active route (PLR-165).
 * Nothing is sent when there is no route to report on, when permission is refused, or when there
 * is no fix. A position of 0, 0 is never sent. Returns the state so the screen can say so.
 */
export function useDriverLocation(routeIds: string[]): LocationState {
  const [state, setState] = useState<LocationState>('idle')
  const key = routeIds.join(',')
  const idsRef = useRef<string[]>(routeIds)
  idsRef.current = routeIds

  useEffect(() => {
    if (!key) {
      setState('idle')
      return
    }
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState('unsupported')
      return
    }
    let stopped = false

    const ping = () => {
      if (!navigator.onLine) return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (stopped) return
          const { latitude, longitude } = pos.coords
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) return
          setState('sharing')
          for (const routeId of idsRef.current) {
            api
              .post('/dispatch/driver/location', {
                routeId,
                lat: latitude,
                lng: longitude,
                timestamp: new Date(pos.timestamp || Date.now()).toISOString(),
              })
              .catch((e: unknown) => console.warn('[driver-location] ping failed', routeId, e))
          }
        },
        (err) => {
          if (stopped) return
          setState(err.code === err.PERMISSION_DENIED ? 'denied' : 'error')
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 15_000 },
      )
    }

    ping()
    const timer = setInterval(ping, PING_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [key])

  return state
}
