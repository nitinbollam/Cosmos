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
import { EmptyState } from '@/components/cosmos/empty-state'
import { StatusBadge } from '@/components/cosmos/status-badge'
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

function formatAddress(addr: unknown): string {
  if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
    const o = addr as Record<string, unknown>
    if (typeof o.line1 === 'string' && o.line1.trim()) return o.line1
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

function coordsFromAddress(addr: unknown): { lat: number; lng: number } | null {
  if (!addr || typeof addr !== 'object' || Array.isArray(addr)) return null
  const o = addr as Record<string, unknown>
  const lat = typeof o.lat === 'number' ? o.lat : typeof o.latitude === 'number' ? o.latitude : NaN
  const lng = typeof o.lng === 'number' ? o.lng : typeof o.longitude === 'number' ? o.longitude : NaN
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function routeMapEmbedUrl(route: DeliveryRoute): string | null {
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
    if (c) points.push(c)
  }
  if (points.length === 0) return null

  if (points.length === 1) return osmEmbedUrl(points[0].lat, points[0].lng)

  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const pad = 0.02
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
    <Suspense
      fallback={<div className="p-6 text-cosmos-muted text-sm">Loading dispatch…</div>}
    >
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
      navigate(q ? `/admin/dispatch?${q}` : '/admin/dispatch', { scroll: false })
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

  const mapEmbedUrl = useMemo(() => (selected ? routeMapEmbedUrl(selected) : null), [selected])

  const locationStale = useMemo(() => {
    if (!selected?.lastKnownAt) return true
    const t = new Date(selected.lastKnownAt).getTime()
    return Number.isNaN(t) || Date.now() - t > 120_000
  }, [selected?.lastKnownAt])

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col md:flex-row">
      <aside className="w-full shrink-0 border-cosmos-border bg-cosmos-surface md:w-80 md:border-r flex flex-col max-h-[45vh] md:max-h-none md:h-[calc(100vh-4rem)]">
        <div className="p-4 border-b border-cosmos-border space-y-3">
          <h1 className="text-lg font-bold text-cosmos-white">Dispatch</h1>
          <label className="block text-xs text-cosmos-muted">Route date</label>
          <input
            type="date"
            className="w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value)
              setSelectedRouteId(null)
              setRouteInUrl(null)
            }}
          />
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="w-full h-9 rounded-md bg-cosmos-primary text-white text-sm"
          >
            Create route
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {routes.isLoading ? (
            <p className="text-cosmos-muted text-sm p-2">Loading routes…</p>
          ) : routes.error ? (
            <p className="text-red-400 text-sm p-2">Could not load routes.</p>
          ) : (routes.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="🚗"
              title="No routes this day"
              description="Create a route for this date or pick another day."
              action={
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
                >
                  Create route
                </button>
              }
            />
          ) : (
            <ul className="space-y-1">
              {(routes.data ?? []).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRouteId(r.id)
                      setRouteInUrl(r.id)
                    }}
                    className={`w-full text-left rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      selectedRouteId === r.id
                        ? 'bg-cosmos-primary/20 border border-cosmos-primary/40 text-cosmos-white'
                        : 'border border-transparent text-cosmos-text hover:bg-cosmos-surface-2'
                    }`}
                  >
                    <div className="font-medium truncate">{r.name?.trim() || 'Route'}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={r.status} />
                      <span className="text-cosmos-muted text-xs">{r.stops?.length ?? 0} stops</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 min-h-[55vh] md:min-h-[calc(100vh-4rem)]">
        {!selectedRouteId || routeDetail.isLoading ? (
          <div className="p-6 text-cosmos-muted text-sm">Select a route…</div>
        ) : routeDetail.error || !selected ? (
          <div className="p-6 text-red-400 text-sm">Route not found.</div>
        ) : (
          <>
            <div className="p-4 border-b border-cosmos-border flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-semibold text-cosmos-white truncate">
                    {selected.name?.trim() || 'Route'}
                  </h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="font-mono text-xs text-cosmos-muted mt-0.5 truncate">{selected.id}</p>
                {driverLabel && (
                  <p className="text-xs text-cosmos-muted mt-1">
                    Driver: <span className="text-cosmos-text">{driverLabel}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AssignDriverSelect
                  disabled={
                    assign.isPending || selected.status === 'COMPLETED' || selected.status === 'CANCELLED'
                  }
                  users={(users.data?.items ?? []) as UserRow[]}
                  onAssign={(driverId) => assign.mutate({ routeId: selected.id, driverId })}
                />
              </div>
            </div>

            <div className="border-b border-cosmos-border bg-cosmos-surface-2/40 shrink-0">
              {mapEmbedUrl ? (
                <div className="relative">
                  <iframe
                    title="Route map"
                    src={mapEmbedUrl}
                    className="w-full h-[200px] md:h-[260px] border-0 block"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[10px] text-white/90 bg-black/50">
                    ©{' '}
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      OpenStreetMap
                    </a>{' '}
                    contributors
                  </div>
                </div>
              ) : (
                <div className="h-[140px] md:h-[180px] flex flex-col items-center justify-center px-4 text-center text-cosmos-muted text-sm">
                  <p>No driver GPS yet for this route.</p>
                  <p className="text-xs mt-1 max-w-md">
                    When an assigned driver uses the delivery PWA (`/m/delivery`), positions appear here (refreshed every 15s while
                    the route is active).
                  </p>
                  <iframe
                    title="OpenStreetMap embed"
                    className="mt-3 w-full max-w-xl h-24 border-0 rounded opacity-90"
                    loading="lazy"
                    src="https://www.openstreetmap.org/export/embed.html?bbox=-125%2C24%2C-66%2C50&layer=mapnik"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                  <p className="text-[10px] mt-1">
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="text-cosmos-primary underline">
                      © OpenStreetMap
                    </a>
                  </p>
                </div>
              )}
              {mapEmbedUrl && selected.lastKnownAt && (
                <p className={`text-xs px-3 py-1 ${locationStale ? 'text-amber-400' : 'text-cosmos-muted'}`}>
                  Last position: {new Date(selected.lastKnownAt).toLocaleString()}
                  {locationStale ? ' · may be stale' : ''}
                </p>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-cosmos-white">Stops</h3>
                <span className="text-xs text-cosmos-muted">Drag to reorder · POD records delivery</span>
              </div>
              {reorderStops.error && (
                <p className="text-red-400 text-xs mb-2">{errMsg(reorderStops.error)}</p>
              )}
              {assign.error && <p className="text-red-400 text-xs mb-2">{errMsg(assign.error)}</p>}
              <StopsSortableSection
                route={selected}
                disabled={
                  reorderStops.isPending || selected.status === 'COMPLETED' || selected.status === 'CANCELLED'
                }
                onReorder={(stopIds) => reorderStops.mutate({ routeId: selected.id, stopIds })}
                onPod={(s) => setPodForStop(s)}
                onFailed={(s) => {
                  const reason = window.prompt('Failure reason (optional)') ?? undefined
                  markFailed.mutate({ routeId: selected.id, stopId: s.id, reason: reason || undefined })
                }}
                failPending={markFailed.isPending}
              />
              {markFailed.error && (
                <p className="text-red-400 text-xs mt-2">{errMsg(markFailed.error)}</p>
              )}
            </div>
          </>
        )}
      </main>

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
    <div className="flex items-center gap-1 max-w-[240px]">
      <select
        className="flex-1 min-w-0 rounded-md bg-cosmos-surface-2 border border-cosmos-border px-2 py-1.5 text-xs text-cosmos-text"
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
        className="shrink-0 px-2 py-1.5 rounded border border-cosmos-border text-xs text-cosmos-text disabled:opacity-40"
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
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-cosmos-border bg-cosmos-surface px-3 py-2 flex flex-wrap gap-2 items-start ${
        isDragging ? 'opacity-70 shadow-lg z-10' : ''
      }`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-cosmos-muted touch-none px-1"
        disabled={props.disabled}
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        ⋮⋮
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-cosmos-muted">Stop {props.stop.sequence}</div>
        <div className="text-sm text-cosmos-text truncate" title={formatAddress(props.stop.address)}>
          {formatAddress(props.stop.address)}
        </div>
        <div className="mt-1">
          <StatusBadge status={props.stop.status} />
        </div>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <button
          type="button"
          disabled={props.stop.status === 'DELIVERED'}
          className="text-xs px-2 py-1 rounded bg-cosmos-primary text-white disabled:opacity-40"
          onClick={props.onPod}
        >
          POD
        </button>
        <button
          type="button"
          disabled={props.stop.status === 'FAILED' || props.failPending}
          className="text-xs px-2 py-1 rounded border border-cosmos-border text-cosmos-muted disabled:opacity-40"
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
    return <p className="text-cosmos-muted text-sm">No stops on this route.</p>
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
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
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-xl sm:rounded-xl bg-cosmos-surface border border-cosmos-border p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-cosmos-white">Proof of delivery</h2>
        <p className="text-xs text-cosmos-muted mt-1">
          Stop {props.stop.sequence} · {formatAddress(props.stop.address)}
        </p>
        <label className="block mt-4 text-xs text-cosmos-muted">Recipient name</label>
        <input
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Who signed"
        />
        <label className="block mt-3 text-xs text-cosmos-muted">Notes</label>
        <textarea
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text min-h-[72px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Condition, location, etc."
        />
        <label className="block mt-3 text-xs text-cosmos-muted">Signature (text / ref)</label>
        <input
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="Signature label or image URL"
        />
        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-md border border-cosmos-border text-cosmos-text text-sm"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className="flex-1 h-10 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? 'Saving…' : 'Mark delivered'}
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
  const [name, setName] = useState('')
  const [stopLines, setStopLines] = useState([{ address: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
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
    const scheduled = new Date(`${props.scheduledDate}T12:00:00`)
    setBusy(true)
    try {
      await api.post('/routes', {
        name: name.trim() || undefined,
        scheduledFor: scheduled.toISOString(),
        stops,
      })
      props.onCreated()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-lg bg-cosmos-surface border-l border-cosmos-border p-6 overflow-y-auto">
        <h2 className="text-lg font-semibold text-cosmos-white">New delivery route</h2>
        <p className="text-xs text-cosmos-muted mt-1">
          Scheduled for sidebar date ({props.scheduledDate}). Stops are ordered; drag after save on the main view.
        </p>
        <label className="block mt-4 text-xs text-cosmos-muted">Name (optional)</label>
        <input
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Monday downtown"
        />
        <p className="text-xs text-cosmos-muted mt-4">Stops</p>
        {stopLines.map((ln, idx) => (
          <div key={idx} className="mt-2 flex gap-2">
            <span className="w-6 text-cosmos-muted text-sm pt-2">{idx + 1}.</span>
            <input
              className="flex-1 rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
              placeholder="Address line"
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
          className="mt-2 text-xs text-cosmos-primary"
          onClick={() => setStopLines((s) => [...s, { address: '' }])}
        >
          + Add stop
        </button>
        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-md border border-cosmos-border text-cosmos-text text-sm"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className="flex-1 h-10 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? 'Creating…' : 'Create route'}
          </button>
        </div>
      </div>
    </div>
  )
}
