import { create } from 'zustand'

export interface Stop {
  id: string
  routeId: string
  orderId: string
  customerName: string
  address: string
  latitude: number
  longitude: number
  packageCount: number
  status: 'PENDING' | 'DELIVERED' | 'FAILED'
}

interface RouteState {
  routeId: string | null
  stops: Stop[]
  currentStopIndex: number
  setRoute: (routeId: string, stops: Stop[]) => void
  seedDemoRoute: () => void
  markDelivered: (id: string) => Promise<void>
  markFailed: (id: string) => Promise<void>
}

export const useRouteStore = create<RouteState>((set, get) => ({
  routeId: null,
  stops: [],
  currentStopIndex: 0,
  setRoute: (routeId, stops) => set({ routeId, stops, currentStopIndex: 0 }),
  seedDemoRoute: () =>
    set({
      routeId: 'local-demo-route',
      currentStopIndex: 0,
      stops: [
        {
          routeId: 'local-demo-route',
          id: 'stop-a',
          orderId: 'ord-1001',
          customerName: 'Acme Tobacco',
          address: '742 Evergreen Terrace, Shelbyville',
          latitude: 40.758,
          longitude: -73.9855,
          packageCount: 3,
          status: 'PENDING',
        },
        {
          routeId: 'local-demo-route',
          id: 'stop-b',
          orderId: 'ord-2044',
          customerName: 'Quick Mart',
          address: '1901 W Madison St',
          latitude: 40.762,
          longitude: -73.98,
          packageCount: 1,
          status: 'PENDING',
        },
      ],
    }),
  async markDelivered(id) {
    const { stops } = get()
    const nextStops = stops.map((s) =>
      s.id === id ? { ...s, status: 'DELIVERED' as const } : s,
    )
    const pendingIdx = nextStops.findIndex((s) => s.status === 'PENDING')
    set({
      stops: nextStops,
      currentStopIndex: pendingIdx >= 0 ? pendingIdx : nextStops.length,
    })
  },
  async markFailed(id) {
    const { stops } = get()
    const nextStops = stops.map((s) =>
      s.id === id ? { ...s, status: 'FAILED' as const } : s,
    )
    const pendingIdx = nextStops.findIndex((s) => s.status === 'PENDING')
    set({
      stops: nextStops,
      currentStopIndex: pendingIdx >= 0 ? pendingIdx : nextStops.length,
    })
  },
}))
