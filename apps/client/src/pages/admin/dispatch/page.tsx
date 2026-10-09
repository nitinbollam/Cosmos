import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '@/components/pleros/empty-state'
import { StatusBadge } from '@/components/pleros/status-badge'
import { api } from '@/lib/api-admin'
import { useQueryParams } from '@/lib/use-query-params'

type RouteStop = {
  id: string
  sequence: number
  status: string
  address: unknown
}

type DeliveryRoute = {
  id: string
  name?: string | null
  status: string
  driverId?: string | null
  scheduledFor?: string | null
  lastKnownLat?: number | null
  lastKnownLng?: number | null
  lastKnownAt?: string | null
  createdAt?: string
  stops: RouteStop[]
}

type UserRow = { id: string; email: string; firstName?: string | null; lastName?: string | null }

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function userLabel(u: UserRow) {
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
  return n || u.email
}

function formatRouteCode(id: string): string {
  if (!id) return 'RTE-001'
  if (id.startsWith('seed_route_')) return `RTE-${id.replace('seed_route_', '').toUpperCase()}`
  return `RTE-${id.slice(-6).toUpperCase()}`
}

function formatRouteTitle(r: DeliveryRoute): string {
  if (r.name && r.name.trim() && !r.name.toLowerCase().startsWith('delivery ·')) {
    return r.name.trim()
  }
  return `Delivery Route #${formatRouteCode(r.id)}`
}

function formatAddress(addr: unknown): string {
  if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
    const o = addr as Record<string, unknown>
    if (typeof o.line1 === 'string' && o.line1.trim()) {
      const parts = [o.line1, o.city, o.state, o.postalCode].filter((x) => typeof x === 'string' && (x as string).trim())
      return parts.join(', ')
    }
    if (typeof o.formatted === 'string') return o.formatted
  }
  try {
    return JSON.stringify(addr)
  } catch {
    return String(addr)
  }
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

/** OSM embed iframe — staticmap.openstreetmap.de is often unreachable. */
function osmEmbedUrl(lat: number, lng: number, zoom = 14): string {
  const scale = 360 / 2 ** zoom
  const dLon = scale * 0.85
  const dLat = scale * 0.5
  const bbox = [lng - dLon, lat - dLat, lng + dLon, lat + dLat].join(',')
  const marker = encodeURIComponent(`${lat},${lng}`)
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${marker}`
}

function coordsFromAddress(addr: unknown): { lat: number; lng: number } {
  if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
    const o = addr as Record<string, unknown>
    const lat = typeof o.lat === 'number' ? o.lat : typeof o.latitude === 'number' ? o.latitude : NaN
    const lng = typeof o.lng === 'number' ? o.lng : typeof o.longitude === 'number' ? o.longitude : NaN
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }

    const city = String(o.city || '').toLowerCase().trim()
    const state = String(o.state || '').toLowerCase().trim()
    const line1 = String(o.line1 || '').toLowerCase().trim()
    const full = `${line1} ${city} ${state}`

    if (full.includes('fort worth') || city.includes('fort worth')) return { lat: 32.7555, lng: -97.3308 }
    if (full.includes('dallas') || city.includes('dallas')) return { lat: 32.7767, lng: -96.7970 }
    if (full.includes('austin') || city.includes('austin')) return { lat: 30.2672, lng: -97.7431 }
    if (full.includes('houston') || city.includes('houston')) return { lat: 29.7604, lng: -95.3698 }
    if (full.includes('newark') || city.includes('newark')) return { lat: 40.7357, lng: -74.1724 }
    if (full.includes('new york') || city.includes('new york') || state === 'ny') return { lat: 40.7128, lng: -74.0060 }
    if (full.includes('commerce')) return { lat: 32.7555, lng: -97.3308 }
  }

  return { lat: 32.7555, lng: -97.3308 }
}

function routeMapEmbedUrl(route: DeliveryRoute): string {
  const points: { lat: number; lng: number }[] = []
  if (
    typeof route.lastKnownLat === 'number' &&
    typeof route.lastKnownLng === 'number' &&
    Number.isFinite(route.lastKnownLat) &&
    Number.isFinite(route.lastKnownLng)
  ) {
    points.push({ lat: route.lastKnownLat, lng: route.lastKnownLng })
  }
  for (const stop of route.stops ?? []) {
    const c = coordsFromAddress(stop.address)
    points.push(c)
  }
  if (points.length === 0) {
    points.push({ lat: 32.7555, lng: -97.3308 })
  }

  if (points.length === 1) {
    return osmEmbedUrl(points[0].lat, points[0].lng, 14)
  }

  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const pad = 0.03
  const bbox = [
    Math.min(...lngs) - pad,
    Math.min(...lats) - pad,
    Math.max(...lngs) + pad,
    Math.max(...lats) + pad,
  ].join(',')
  const marker = encodeURIComponent(`${points[0].lat},${points[0].lng}`)
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${marker}`
}

export default function DispatchPage() {
  return (
    <Suspense fallback={<div className="p-8 text-pleros-muted text-sm flex items-center gap-2"><span>🚚</span> Loading fleet dispatch…</div>}>
      <DispatchDashboard />
    </Suspense>
  )
}

function DispatchDashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const searchParams = useQueryParams()
  const routeFromUrl = searchParams.get('route')

  const [selectedDate, setSelectedDate] = useState(() => toYmd(new Date()))
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(routeFromUrl)
  const [createOpen, setCreateOpen] = useState(false)
  const [podForStop, setPodForStop] = useState<RouteStop | null>(null)

  useEffect(() => {
    if (routeFromUrl && routeFromUrl !== selectedRouteId) setSelectedRouteId(routeFromUrl)
  }, [routeFromUrl, selectedRouteId])

  const setRouteInUrl = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams.toString())
      if (id) next.set('route', id)
      else next.delete('route')
      const q = next.toString()
      navigate(q ? `/admin/dispatch?${q}` : '/admin/dispatch', { replace: true })
    },
    [navigate, searchParams],
  )

  const routes = useQuery<DeliveryRoute[]>({
    queryKey: ['dispatch-routes', selectedDate],
    queryFn: () => api.get(`/routes?date=${encodeURIComponent(selectedDate)}`),
  })

  const users = useQuery<{ items: UserRow[] }>({
    queryKey: ['users', 'dispatch'],
    queryFn: () => api.get('/users?pageSize=200'),
  })

  const routeDetail = useQuery<DeliveryRoute>({
    queryKey: ['dispatch-route', selectedRouteId],
    queryFn: () => api.get(`/routes/${encodeURIComponent(selectedRouteId!)}`),
    enabled: !!selectedRouteId,
    refetchInterval: (q) => {
      const d = q.state.data
      if (!d?.driverId || d.status === 'COMPLETED' || d.status === 'CANCELLED') return false
      return 15_000
    },
  })

  useEffect(() => {
    if (!routes.isSuccess || !routes.data) return
    const list = routes.data
    if (list.length === 0) {
      if (selectedRouteId) {
        setSelectedRouteId(null)
        setRouteInUrl(null)
      }
      return
    }
    if (selectedRouteId && !list.some((r) => r.id === selectedRouteId)) {
      const first = list[0].id
      setSelectedRouteId(first)
      setRouteInUrl(first)
    } else if (!selectedRouteId) {
      const pick = routeFromUrl && list.some((r) => r.id === routeFromUrl) ? routeFromUrl : list[0].id
      setSelectedRouteId(pick)
      setRouteInUrl(pick)
    }
  }, [routes.isSuccess, routes.data, selectedRouteId, routeFromUrl, setRouteInUrl])

  const assign = useMutation({
    mutationFn: ({ routeId, driverId }: { routeId: string; driverId: string }) =>
      api.patch(`/routes/${encodeURIComponent(routeId)}/driver`, { driverId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
      void qc.invalidateQueries({ queryKey: ['dispatch-route', selectedRouteId] })
    },
  })

  const reorderStops = useMutation({
    mutationFn: ({ routeId, stopIds }: { routeId: string; stopIds: string[] }) =>
      api.patch(`/routes/${encodeURIComponent(routeId)}/stops/reorder`, { stopIds }),
    onSuccess: (_data, v) => {
      void qc.invalidateQueries({ queryKey: ['dispatch-route', v.routeId] })
      void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
    },
  })

  const [viewMode, setViewMode] = useState<'split' | 'list' | 'map'>('split')
  const [optimizeMessage, setOptimizeMessage] = useState<string | null>(null)

  const optimizeRoute = useMutation({
    mutationFn: (routeId: string) => api.post(`/routes/${encodeURIComponent(routeId)}/optimize`, {}),
    onSuccess: (_data, routeId) => {
      void qc.invalidateQueries({ queryKey: ['dispatch-route', routeId] })
      void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
      setOptimizeMessage('Route stops sequenced with Nearest-Neighbor spatial algorithm!')
      setTimeout(() => setOptimizeMessage(null), 4000)
    },
  })

  const markFailed = useMutation({
    mutationFn: ({ routeId, stopId, reason }: { routeId: string; stopId: string; reason?: string }) =>
      api.post(`/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/failed`, {
        reason: reason || undefined,
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['dispatch-route', v.routeId] })
      void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
    },
  })

  const selected = routeDetail.data
  const driverLabel = useMemo(() => {
    if (!selected?.driverId) return null
    const u = (users.data?.items ?? []).find((x) => x.id === selected.driverId)
    return u ? userLabel(u) : selected.driverId
  }, [selected?.driverId, users.data?.items])

  const mapEmbedUrl = useMemo(() => (selected ? routeMapEmbedUrl(selected) : ''), [selected])

  const deliveredCount = useMemo(() => {
    return selected?.stops?.filter((s) => s.status === 'DELIVERED').length ?? 0
  }, [selected?.stops])

  const totalStops = selected?.stops?.length ?? 0
  const progressPercent = totalStops > 0 ? Math.round((deliveredCount / totalStops) * 100) : 0

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row bg-pleros-bg">
      {/* Left Sidebar: Routes Manifest */}
      <aside className="w-full shrink-0 border-pleros-border bg-pleros-surface md:w-80 md:border-r flex flex-col max-h-[45vh] md:max-h-none md:h-[calc(100vh-4rem)]">
        <div className="p-4 border-b border-pleros-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🚚</span>
              <h2 className="text-base font-bold text-pleros-white">Fleet Routes</h2>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-pleros-surface-2 text-pleros-muted border border-pleros-border">
              {routes.data?.length ?? 0} active
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wider text-pleros-muted mb-1.5">
              Manifest Date
            </label>
            <input
              type="date"
              className="w-full rounded-lg bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-xs font-medium text-pleros-text focus:outline-none focus:border-pleros-primary transition-colors"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value)
                setSelectedRouteId(null)
                setRouteInUrl(null)
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="w-full h-9 rounded-lg bg-pleros-primary hover:bg-pleros-primary/90 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-[0.98]"
          >
            <span>+</span> Create New Route
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {routes.isLoading ? (
            <div className="p-4 text-center text-pleros-muted text-xs">Loading routes…</div>
          ) : routes.error ? (
            <div className="p-4 text-center text-red-400 text-xs">Could not load routes.</div>
          ) : (routes.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="🚗"
              title="No routes this day"
              description="Create a route for this date or pick another day."
              action={
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="h-8 px-3 rounded-md bg-pleros-primary text-white text-xs font-medium"
                >
                  Create route
                </button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {(routes.data ?? []).map((r) => {
                const isSelected = selectedRouteId === r.id
                const rDriver = users.data?.items?.find((u) => u.id === r.driverId)
                const dName = rDriver ? userLabel(rDriver) : 'Unassigned'
                const completedStops = r.stops?.filter((s) => s.status === 'DELIVERED').length ?? 0

                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRouteId(r.id)
                        setRouteInUrl(r.id)
                      }}
                      className={`w-full text-left rounded-xl p-3 text-xs transition-all border ${
                        isSelected
                          ? 'bg-pleros-primary/10 border-pleros-primary shadow-sm text-pleros-white'
                          : 'bg-pleros-surface-2/40 border-pleros-border/60 text-pleros-text hover:bg-pleros-surface-2 hover:border-pleros-border'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-pleros-white truncate text-sm">
                          {formatRouteTitle(r)}
                        </div>
                        <StatusBadge status={r.status} />
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[11px] text-pleros-muted">
                        <span className="flex items-center gap-1">
                          <span>📍</span> {r.stops?.length ?? 0} stops ({completedStops} delivered)
                        </span>
                        <span className={`flex items-center gap-1 font-medium ${r.driverId ? 'text-emerald-400' : 'text-amber-400'}`}>
                          <span>👤</span> {dName}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 min-h-[55vh] md:min-h-[calc(100vh-4rem)]">
        {!selectedRouteId || routeDetail.isLoading ? (
          <div className="p-8 text-center text-pleros-muted text-sm flex flex-col items-center justify-center flex-1">
            <span className="text-3xl mb-2">🗺️</span>
            <p>Select a route from the sidebar or create a new one.</p>
          </div>
        ) : routeDetail.error || !selected ? (
          <div className="p-8 text-center text-red-400 text-sm flex flex-col items-center justify-center flex-1">
            <span className="text-3xl mb-2">⚠️</span>
            <p>Route details could not be loaded.</p>
          </div>
        ) : (
          <>
            {/* Action Bar Header */}
            <div className="p-4 md:px-6 border-b border-pleros-border bg-pleros-surface/60 backdrop-blur flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-lg md:text-xl font-bold text-pleros-white tracking-tight">
                    {formatRouteTitle(selected)}
                  </h1>
                  <StatusBadge status={selected.status} />
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-pleros-surface-2 text-pleros-muted border border-pleros-border">
                    #{formatRouteCode(selected.id)}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-1 text-xs text-pleros-muted">
                  <span>
                    Scheduled: <strong className="text-pleros-text">{selectedDate}</strong>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <span>👤</span>
                    Driver:{' '}
                    {driverLabel ? (
                      <strong className="text-emerald-400">{driverLabel}</strong>
                    ) : (
                      <span className="text-amber-400 font-medium">Unassigned</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Optimize Button */}
                <button
                  type="button"
                  disabled={
                    optimizeRoute.isPending ||
                    selected.status === 'COMPLETED' ||
                    selected.status === 'CANCELLED' ||
                    selected.stops.length <= 1
                  }
                  onClick={() => optimizeRoute.mutate(selected.id)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all disabled:opacity-40"
                  title="Sequence stops using Nearest-Neighbor spatial algorithm"
                >
                  <span>⚡</span> {optimizeRoute.isPending ? 'Optimizing…' : 'Optimize Route (Nearest-Neighbor)'}
                </button>

                {/* View Switcher */}
                <div className="flex rounded-lg border border-pleros-border bg-pleros-surface-2 p-0.5 text-xs font-medium">
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-md transition-colors ${
                      viewMode === 'split' ? 'bg-pleros-primary text-white shadow-sm' : 'text-pleros-muted hover:text-pleros-white'
                    }`}
                    onClick={() => setViewMode('split')}
                  >
                    Split
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-md transition-colors ${
                      viewMode === 'map' ? 'bg-pleros-primary text-white shadow-sm' : 'text-pleros-muted hover:text-pleros-white'
                    }`}
                    onClick={() => setViewMode('map')}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1 rounded-md transition-colors ${
                      viewMode === 'list' ? 'bg-pleros-primary text-white shadow-sm' : 'text-pleros-muted hover:text-pleros-white'
                    }`}
                    onClick={() => setViewMode('list')}
                  >
                    List
                  </button>
                </div>

                {/* Driver Assignment Select */}
                <AssignDriverSelect
                  disabled={
                    assign.isPending || selected.status === 'COMPLETED' || selected.status === 'CANCELLED'
                  }
                  users={(users.data?.items ?? []) as UserRow[]}
                  onAssign={(driverId) => assign.mutate({ routeId: selected.id, driverId })}
                />
              </div>
            </div>

            {/* Optimize Notification Banner */}
            {optimizeMessage && (
              <div className="py-2 px-6 bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-400 text-xs font-medium flex items-center gap-2">
                <span>✅</span> {optimizeMessage}
              </div>
            )}

            {/* Live Interactive Map View */}
            {(viewMode === 'split' || viewMode === 'map') && (
              <div className="border-b border-pleros-border bg-pleros-surface-2/30 shrink-0">
                <div className="relative">
                  <iframe
                    title="Fleet Route Live Map"
                    src={mapEmbedUrl}
                    className={`w-full ${
                      viewMode === 'map' ? 'h-[440px] md:h-[540px]' : 'h-[240px] md:h-[300px]'
                    } border-0 block`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />

                  {/* Top floating Map Status Pill */}
                  <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
                    <div className="px-3 py-1.5 rounded-lg bg-black/85 backdrop-blur-md border border-white/15 text-white text-xs font-semibold flex items-center gap-2 shadow-lg">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Live Fleet Map · {selected.stops.length} Stop(s) Plotted</span>
                    </div>
                  </div>

                  {/* Bottom Map Info Bar */}
                  <div className="absolute bottom-0 left-0 right-0 px-4 py-2 text-[11px] text-white/90 bg-black/85 backdrop-blur-md border-t border-white/10 flex justify-between items-center">
                    <span className="flex items-center gap-2">
                      <span className="text-emerald-400 font-medium">📍 {selected.stops[0] ? formatAddress(selected.stops[0].address) : 'Route Area'}</span>
                      <span className="text-white/40">|</span>
                      <span>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-white">OpenStreetMap</a></span>
                    </span>
                    <span className="font-mono text-emerald-400 font-medium">
                      ⚡ Spatial Sequence Active
                    </span>
                  </div>
                </div>

                {/* Sub-bar Telemetry & Progress Strip */}
                <div className="px-4 py-2.5 bg-pleros-surface border-t border-pleros-border flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 font-medium text-pleros-text">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>GPS Telemetry Active</span>
                    </span>
                    <span className="text-pleros-border">•</span>
                    <span className="text-pleros-muted">
                      Driver: <strong className={driverLabel ? 'text-emerald-400' : 'text-amber-400'}>{driverLabel ?? 'Unassigned'}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-pleros-muted font-medium">
                      Completion: <strong className="text-pleros-white">{progressPercent}%</strong> ({deliveredCount}/{totalStops} Stops)
                    </span>
                    <div className="w-28 h-2 rounded-full bg-pleros-surface-2 overflow-hidden border border-pleros-border">
                      <div
                        className="h-full bg-gradient-to-r from-pleros-primary to-emerald-500 transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Stops Sequence Section */}
            {(viewMode === 'split' || viewMode === 'list') && (
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-pleros-white flex items-center gap-2">
                      <span>📍 Delivery Stops</span>
                      <span className="text-xs font-normal text-pleros-muted">({selected.stops.length} Total)</span>
                    </h3>
                    <p className="text-xs text-pleros-muted mt-0.5">
                      Drag cards by the <code className="text-[11px] font-bold">⋮⋮</code> handle to adjust delivery sequence manually.
                    </p>
                  </div>

                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                    ⚡ Spatial Sequence Active
                  </span>
                </div>

                {reorderStops.error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                    {errMsg(reorderStops.error)}
                  </div>
                )}
                {assign.error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                    {errMsg(assign.error)}
                  </div>
                )}

                <StopsSortableSection
                  route={selected}
                  disabled={
                    reorderStops.isPending ||
                    selected.status === 'COMPLETED' ||
                    selected.status === 'CANCELLED'
                  }
                  onReorder={(stopIds) => reorderStops.mutate({ routeId: selected.id, stopIds })}
                  onPod={(s) => setPodForStop(s)}
                  onFailed={(s) => {
                    const reason = window.prompt('Failure reason (e.g. business closed, customer absent)') ?? undefined
                    markFailed.mutate({ routeId: selected.id, stopId: s.id, reason: reason || undefined })
                  }}
                  failPending={markFailed.isPending}
                />

                {markFailed.error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                    {errMsg(markFailed.error)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Drawers and Modals */}
      {createOpen && (
        <CreateRouteDrawer
          scheduledDate={selectedDate}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            void qc.invalidateQueries({ queryKey: ['dispatch-routes', selectedDate] })
          }}
        />
      )}

      {podForStop && selectedRouteId && (
        <PodModal
          routeId={selectedRouteId}
          stop={podForStop}
          onClose={() => setPodForStop(null)}
          onDone={() => {
            setPodForStop(null)
            void qc.invalidateQueries({ queryKey: ['dispatch-route', selectedRouteId] })
            void qc.invalidateQueries({ queryKey: ['dispatch-routes', selectedDate] })
          }}
        />
      )}
    </div>
  )
}

function AssignDriverSelect(props: {
  disabled: boolean
  users: UserRow[]
  onAssign: (driverId: string) => void
}) {
  const [v, setV] = useState('')
  return (
    <div className="flex items-center gap-1.5">
      <select
        className="rounded-lg bg-pleros-surface-2 border border-pleros-border px-2.5 py-1.5 text-xs text-pleros-text focus:outline-none focus:border-pleros-primary transition-colors"
        value={v}
        disabled={props.disabled}
        onChange={(e) => setV(e.target.value)}
      >
        <option value="">Assign driver…</option>
        {props.users.map((u) => (
          <option key={u.id} value={u.id}>
            {userLabel(u)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={props.disabled || !v}
        className="px-3 py-1.5 rounded-lg bg-pleros-surface-2 hover:bg-pleros-surface border border-pleros-border text-xs font-semibold text-pleros-white disabled:opacity-40 transition-colors"
        onClick={() => {
          props.onAssign(v)
          setV('')
        }}
      >
        Set
      </button>
    </div>
  )
}

function SortableStopRow(props: {
  stop: RouteStop
  disabled: boolean
  onPod: () => void
  onFailed: () => void
  failPending: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.stop.id,
    disabled: props.disabled,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isDelivered = props.stop.status === 'DELIVERED'
  const isFailed = props.stop.status === 'FAILED'

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border transition-all p-3.5 flex flex-wrap gap-3 items-center justify-between ${
        isDragging
          ? 'opacity-80 shadow-2xl z-20 bg-pleros-surface-2 border-pleros-primary'
          : isDelivered
          ? 'bg-emerald-500/5 border-emerald-500/20'
          : isFailed
          ? 'bg-red-500/5 border-red-500/20'
          : 'bg-pleros-surface border-pleros-border hover:border-pleros-border/80'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Drag Handle */}
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-pleros-muted hover:text-pleros-white touch-none p-1 rounded hover:bg-pleros-surface-2 transition-colors"
          disabled={props.disabled}
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <span className="font-mono text-base font-bold">⋮⋮</span>
        </button>

        {/* Sequence Badge */}
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 border ${
            isDelivered
              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
              : isFailed
              ? 'bg-red-500/20 text-red-400 border-red-500/40'
              : 'bg-pleros-surface-2 text-pleros-white border-pleros-border'
          }`}
        >
          {props.stop.sequence}
        </div>

        {/* Address and Details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-pleros-white">Stop #{props.stop.sequence}</span>
            <StatusBadge status={props.stop.status} />
          </div>
          <div className="text-sm font-medium text-pleros-text mt-0.5 truncate flex items-center gap-1.5" title={formatAddress(props.stop.address)}>
            <span>📍</span>
            <span>{formatAddress(props.stop.address)}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          disabled={isDelivered}
          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-all ${
            isDelivered
              ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
          }`}
          onClick={props.onPod}
        >
          {isDelivered ? '✓ Delivered (POD)' : 'Capture POD'}
        </button>
        <button
          type="button"
          disabled={isFailed || props.failPending}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-pleros-border text-pleros-muted hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-30"
          onClick={props.onFailed}
        >
          Failed
        </button>
      </div>
    </li>
  )
}

function StopsSortableSection(props: {
  route: DeliveryRoute
  disabled: boolean
  onReorder: (stopIds: string[]) => void
  onPod: (s: RouteStop) => void
  onFailed: (s: RouteStop) => void
  failPending: boolean
}) {
  const stops = props.route.stops ?? []
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = stops.map((s) => s.id)
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(stops, oldIndex, newIndex).map((s) => s.id)
    props.onReorder(next)
  }

  if (stops.length === 0) {
    return (
      <div className="p-8 text-center text-pleros-muted text-sm rounded-xl border border-dashed border-pleros-border bg-pleros-surface/30">
        No delivery stops assigned to this route.
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2.5">
          {stops.map((s) => (
            <SortableStopRow
              key={s.id}
              stop={s}
              disabled={props.disabled}
              onPod={() => props.onPod(s)}
              onFailed={() => props.onFailed(s)}
              failPending={props.failPending}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function PodModal(props: {
  routeId: string
  stop: RouteStop
  onClose: () => void
  onDone: () => void
}) {
  const [recipient, setRecipient] = useState('')
  const [notes, setNotes] = useState('')
  const [signature, setSignature] = useState('')
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      await api.post(
        `/routes/${encodeURIComponent(props.routeId)}/stops/${encodeURIComponent(props.stop.id)}/delivered`,
        {
          recipientName: recipient.trim() || undefined,
          notes: notes.trim() || undefined,
          signature: signature.trim() || undefined,
          ageConfirmed,
        },
      )
      props.onDone()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={props.onClose} />
      <div className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-pleros-surface border border-pleros-border p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-pleros-white">Proof of Delivery (POD)</h2>
          <button
            type="button"
            onClick={props.onClose}
            className="text-pleros-muted hover:text-pleros-white text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-pleros-muted">
          Stop #{props.stop.sequence} · {formatAddress(props.stop.address)}
        </p>

        <div>
          <label className="block text-xs font-semibold text-pleros-muted uppercase tracking-wider mb-1">
            Recipient Name
          </label>
          <input
            className="w-full rounded-lg bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text focus:outline-none focus:border-pleros-primary"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="e.g. Alex Smith"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-pleros-muted uppercase tracking-wider mb-1">
            Delivery Notes
          </label>
          <textarea
            className="w-full rounded-lg bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text min-h-[72px] focus:outline-none focus:border-pleros-primary"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Condition, dock location, gate code, etc."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-pleros-muted uppercase tracking-wider mb-1">
            Signature / Reference
          </label>
          <input
            className="w-full rounded-lg bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text focus:outline-none focus:border-pleros-primary"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="Signed in person or reference ID"
          />
        </div>

        <label className="flex items-start gap-2.5 text-xs text-pleros-text cursor-pointer p-3 rounded-lg bg-pleros-surface-2 border border-pleros-border">
          <input
            type="checkbox"
            className="mt-0.5 accent-pleros-primary"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
          />
          <span>Recipient age verified (required for regulated products)</span>
        </label>

        {error && <p className="text-red-400 text-xs">{error}</p>}

        <div className="flex gap-2.5 pt-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-lg border border-pleros-border text-pleros-text hover:bg-pleros-surface-2 text-sm font-semibold transition-colors"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? 'Recording POD…' : '✓ Mark Delivered'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CreateRouteDrawer(props: {
  scheduledDate: string
  onClose: () => void
  onCreated: () => void
}) {
  const [mode, setMode] = useState<'orders' | 'manual'>('orders')
  const [name, setName] = useState('')
  const [stopLines, setStopLines] = useState([{ address: '' }])
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shippedOrders = useQuery<
    Array<{
      id: string
      customerId: string
      status: string
      totalAmount: string | number
      shippingAddress: unknown
      notes: string | null
    }>
  >({
    queryKey: ['dispatch-shipped-orders'],
    queryFn: () => api.get('/routes/shipped-orders'),
    enabled: mode === 'orders',
  })

  function formatShippedAddress(addr: unknown, notes: string | null): string {
    if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
      const o = addr as Record<string, unknown>
      const parts = [o.line1, o.city, o.state, o.postalCode].filter((x) => typeof x === 'string' && (x as string).trim())
      if (parts.length) return parts.join(', ')
    }
    return notes?.slice(0, 80) || 'Address on file'
  }

  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function submit() {
    setError(null)
    const scheduled = new Date(`${props.scheduledDate}T12:00:00`)
    setBusy(true)
    try {
      if (mode === 'orders') {
        if (selectedOrderIds.length === 0) {
          setError('Select at least one shipped order.')
          return
        }
        await api.post('/routes/from-orders', {
          name: name.trim() || undefined,
          scheduledFor: scheduled.toISOString(),
          orderIds: selectedOrderIds,
        })
      } else {
        const stops = stopLines
          .map((l, i) => ({
            sequence: i + 1,
            address: { line1: l.address.trim() } as Record<string, unknown>,
          }))
          .filter((s) => Object.keys(s.address).length && (s.address.line1 as string).length > 0)
        if (stops.length === 0) {
          setError('Add at least one stop with an address.')
          return
        }
        await api.post('/routes', {
          name: name.trim() || undefined,
          scheduledFor: scheduled.toISOString(),
          stops,
        })
      }
      props.onCreated()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Close" onClick={props.onClose} />
      <div className="relative w-full max-w-lg bg-pleros-surface border-l border-pleros-border p-6 overflow-y-auto shadow-2xl flex flex-col justify-between">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-pleros-white">New Delivery Route</h2>
            <button
              type="button"
              onClick={props.onClose}
              className="text-pleros-muted hover:text-pleros-white text-lg leading-none"
            >
              ✕
            </button>
          </div>

          <p className="text-xs text-pleros-muted">
            Scheduled for manifest date <strong>{props.scheduledDate}</strong>.
          </p>

          <div className="flex gap-2 rounded-lg bg-pleros-surface-2 p-1 border border-pleros-border">
            <button
              type="button"
              className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                mode === 'orders' ? 'bg-pleros-primary text-white shadow-sm' : 'text-pleros-muted hover:text-pleros-white'
              }`}
              onClick={() => setMode('orders')}
            >
              From Shipped Orders
            </button>
            <button
              type="button"
              className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                mode === 'manual' ? 'bg-pleros-primary text-white shadow-sm' : 'text-pleros-muted hover:text-pleros-white'
              }`}
              onClick={() => setMode('manual')}
            >
              Manual Custom Stops
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-pleros-muted uppercase tracking-wider mb-1">
              Route Name (Optional)
            </label>
            <input
              className="w-full rounded-lg bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text focus:outline-none focus:border-pleros-primary"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Metro North Route A"
            />
          </div>

          {mode === 'orders' ? (
            <div>
              <label className="block text-xs font-semibold text-pleros-muted uppercase tracking-wider mb-1.5">
                Shipped Orders Ready for Dispatch
              </label>
              {shippedOrders.isLoading ? (
                <p className="text-pleros-muted text-xs p-4 text-center">Loading shipped orders…</p>
              ) : (shippedOrders.data?.length ?? 0) === 0 ? (
                <div className="p-6 text-center text-pleros-muted text-xs rounded-xl border border-dashed border-pleros-border bg-pleros-surface-2/30">
                  No orders currently in SHIPPED status ready for route manifest.
                </div>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {(shippedOrders.data ?? []).map((o) => {
                    const isChecked = selectedOrderIds.includes(o.id)
                    const code = o.id.startsWith('seed_ord_') ? `ORD-${o.id.replace('seed_ord_', '').toUpperCase()}` : `ORD-${o.id.slice(-6).toUpperCase()}`

                    return (
                      <li key={o.id}>
                        <label
                          className={`flex items-start gap-3 rounded-xl border p-3 text-xs cursor-pointer transition-colors ${
                            isChecked
                              ? 'bg-pleros-primary/10 border-pleros-primary text-pleros-white'
                              : 'bg-pleros-surface-2/40 border-pleros-border hover:bg-pleros-surface-2'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 accent-pleros-primary"
                            checked={isChecked}
                            onChange={() => toggleOrder(o.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-pleros-white">#{code}</span>
                              <span className="font-semibold text-emerald-400">${Number(o.totalAmount).toFixed(2)}</span>
                            </div>
                            <p className="text-pleros-text text-xs mt-0.5 truncate">
                              📍 {formatShippedAddress(o.shippingAddress, o.notes)}
                            </p>
                          </div>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-pleros-muted uppercase tracking-wider">
                Custom Stop Addresses
              </label>
              {stopLines.map((ln, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <span className="w-6 text-pleros-muted text-xs font-mono">{idx + 1}.</span>
                  <input
                    className="flex-1 rounded-lg bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-xs text-pleros-text focus:outline-none focus:border-pleros-primary"
                    placeholder="Enter street address, city, state"
                    value={ln.address}
                    onChange={(e) => {
                      const next = [...stopLines]
                      next[idx] = { address: e.target.value }
                      setStopLines(next)
                    }}
                  />
                </div>
              ))}
              <button
                type="button"
                className="text-xs font-semibold text-pleros-primary hover:underline pt-1"
                onClick={() => setStopLines((s) => [...s, { address: '' }])}
              >
                + Add Another Stop
              </button>
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>

        <div className="flex gap-2.5 pt-6 border-t border-pleros-border mt-6">
          <button
            type="button"
            className="flex-1 h-10 rounded-lg border border-pleros-border text-pleros-text hover:bg-pleros-surface-2 text-sm font-semibold transition-colors"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className="flex-1 h-10 rounded-lg bg-pleros-primary hover:bg-pleros-primary/90 text-white text-sm font-semibold shadow-sm transition-colors disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? 'Creating Route…' : 'Create Route'}
          </button>
        </div>
      </div>
    </div>
  )
}
