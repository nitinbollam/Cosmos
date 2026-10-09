import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { isForbidden } from '@/lib/axios-error'
import { StatusBadge } from '@/components/pleros/status-badge'
import { FailStopForm } from '@/components/pod/FailStopForm'
import { StopOutcomeDetails, type StopOutcomePod } from '@/components/pod/StopOutcomeDetails'
import { AgeTag, StopItems, type StopItem } from '@/components/pod/StopItems'

type RouteStop = {
  id: string
  sequence: number
  status: string
  address: unknown
  pod?: StopOutcomePod | null
  items?: StopItem[]
  ageRestricted?: boolean
  minimumAge?: number | null
}
type DeliveryRoute = {
  id: string
  name?: string | null
  status: string
  driverId?: string | null
  stops: RouteStop[]
}

type UserRow = { id: string; email: string; firstName?: string | null; lastName?: string | null }

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

export default function DispatchRouteDetailPage() {
  const params = useParams()
  const routeId = typeof params.routeId === 'string' ? params.routeId : params.routeId?.[0] ?? ''
  const qc = useQueryClient()
  const [driverId, setDriverId] = useState('')

  const route = useQuery<DeliveryRoute>({
    queryKey: ['dispatch-route', routeId],
    queryFn: () => api.get(`/routes/${encodeURIComponent(routeId)}`),
    enabled: !!routeId,
  })

  const users = useQuery<{ items: UserRow[] }>({
    queryKey: ['users', 'dispatch-detail'],
    queryFn: () => api.get('/users?pageSize=200'),
    // A role without users.read gets 403; retrying won't change that.
    retry: (count, e) => !isForbidden(e) && count < 3,
  })

  const nameFor = (userId: string) => {
    const u = (users.data?.items ?? []).find((x) => x.id === userId)
    return u ? userLabel(u) : null
  }

  const assign = useMutation({
    mutationFn: () => api.patch<DeliveryRoute>(`/routes/${encodeURIComponent(routeId)}/driver`, { driverId }),
    onSuccess: (updated) => {
      setDriverId('')
      // The response is the route as just written (now ASSIGNED); a re-read can lag behind it.
      qc.setQueryData(['dispatch-route', routeId], updated)
      void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
    },
  })

  const [failingStopId, setFailingStopId] = useState<string | null>(null)

  // Undo an assignment: the driver comes off and the route goes back to PLANNED.
  const unassign = useMutation({
    mutationFn: () => api.delete<DeliveryRoute>(`/routes/${encodeURIComponent(routeId)}/driver`),
    onSuccess: (updated) => {
      qc.setQueryData(['dispatch-route', routeId], updated)
      void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
    },
  })

  const markFailed = useMutation({
    mutationFn: ({ stopId, reason }: { stopId: string; reason: string }) =>
      api.post<DeliveryRoute>(`/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/failed`, {
        reason,
      }),
    onSuccess: (updated) => {
      // The response is the route as just written; a re-read can lag behind it.
      qc.setQueryData(['dispatch-route', routeId], updated)
      void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
      setFailingStopId(null)
    },
  })

  if (!routeId) return null

  const r = route.data
  // Mirrors the server rule: back to PLANNED only before any stop has an outcome.
  const unassignBlocked = !r
    ? null
    : r.status === 'COMPLETED' || r.status === 'CANCELLED'
      ? `Route is ${r.status.toLowerCase()}`
      : r.stops.some((s) => s.status === 'DELIVERED' || s.status === 'FAILED')
        ? 'Stops already delivered or failed; assign another driver instead of unassigning'
        : null

  return (
    <div className="p-6 space-y-6">
      <Link to="/admin/dispatch" className="text-sm text-pleros-muted hover:text-pleros-white">
        ← Dispatch
      </Link>

      {route.isLoading ? (
        <p className="text-pleros-muted">Loading…</p>
      ) : route.error || !r ? (
        <p className="text-red-400">Route not found</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-pleros-white">{r.name?.trim() || 'Route'}</h1>
              <p className="font-mono text-xs text-pleros-muted mt-1">{r.id}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={r.status} />
                {r.driverId && (
                  <span className="text-xs text-pleros-muted">
                    Driver: <span className="text-pleros-text">{nameFor(r.driverId) ?? 'Assigned'}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <Card>
            <CardTitle>Assign driver</CardTitle>
            <p className="text-xs text-pleros-muted mt-1">
              Sets the route to Assigned; it becomes In progress when the driver delivers or fails the first stop.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 max-w-xl">
              <select
                className="flex-1 min-w-[200px] rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                disabled={r.status === 'COMPLETED' || r.status === 'CANCELLED'}
              >
                <option value="">Select user…</option>
                {(users.data?.items ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {userLabel(u)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!driverId || assign.isPending || r.status === 'COMPLETED' || r.status === 'CANCELLED'}
                onClick={() => assign.mutate()}
                className="h-10 px-4 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-40"
              >
                {assign.isPending ? 'Saving…' : 'Assign'}
              </button>
              {r.driverId && (
                <button
                  type="button"
                  disabled={unassign.isPending || !!unassignBlocked}
                  title={unassignBlocked ?? 'Remove the driver and move the route back to Planned'}
                  onClick={() => unassign.mutate()}
                  className="h-10 px-4 rounded-md border border-pleros-border text-pleros-text text-sm disabled:opacity-40"
                >
                  {unassign.isPending ? 'Unassigning…' : 'Unassign'}
                </button>
              )}
            </div>
            {unassignBlocked && r.driverId && <p className="text-xs text-pleros-muted mt-2">{unassignBlocked}</p>}
            {(assign.error || unassign.error) && (
              <p className="text-red-400 text-xs mt-2">{errMsg(assign.error ?? unassign.error)}</p>
            )}
          </Card>

          <Card>
            <CardTitle>Stops</CardTitle>
            <p className="text-xs text-pleros-muted mt-1">
              Stops are marked delivered from the driver app (`/m/delivery`), which requires a photo
              and the recipient's signature. Staff can mark a stop failed here.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-pleros-muted border-b border-pleros-border">
                    <th className="pb-2 pr-4">#</th>
                    <th className="pb-2 pr-4">Address</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Proof</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {r.stops.map((s) => (
                    <tr key={s.id} className="border-b border-pleros-border/60">
                      <td className="py-2 pr-4 text-pleros-muted">{s.sequence}</td>
                      <td className="py-2 pr-4 text-pleros-text max-w-xs align-top">
                        <div className="truncate" title={formatAddress(s.address)}>
                          {formatAddress(s.address)}
                        </div>
                        <StopItems items={s.items} />
                      </td>
                      <td className="py-2 pr-4 align-top">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={s.status} />
                          {s.ageRestricted && <AgeTag minimumAge={s.minimumAge ?? null} label="" />}
                        </div>
                      </td>
                      <td className="py-2 pr-4 align-top">
                        {s.status === 'DELIVERED' || s.status === 'FAILED' ? (
                          <StopOutcomeDetails status={s.status} pod={s.pod} nameFor={nameFor} />
                        ) : (
                          <span className="text-xs text-pleros-muted">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        {/* Only a stop still waiting for an outcome can be marked failed. */}
                        {s.status !== 'FAILED' && s.status !== 'DELIVERED' &&
                          (failingStopId === s.id ? (
                            <FailStopForm
                              onSubmit={(reason) => markFailed.mutateAsync({ stopId: s.id, reason })}
                              onCancel={() => setFailingStopId(null)}
                            />
                          ) : (
                            <button
                              type="button"
                              className="text-xs px-2 py-1 rounded border border-pleros-border text-pleros-muted"
                              onClick={() => setFailingStopId(s.id)}
                            >
                              Failed
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {markFailed.error && <p className="text-red-400 text-xs mt-2">{errMsg(markFailed.error)}</p>}
          </Card>
        </>
      )}
    </div>
  )
}
