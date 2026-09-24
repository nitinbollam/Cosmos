import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'
import { PodPhoto } from '@/components/pod/PodPhoto'

type StopPod = { photoUrl?: string | null; deliveredAt?: string | null; recipientName?: string | null }

type RouteStop = {
  id: string
  sequence: number
  status: string
  address: unknown
  pod?: StopPod | null
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
  })

  const assign = useMutation({
    mutationFn: () => api.patch(`/routes/${encodeURIComponent(routeId)}/driver`, { driverId }),
    onSuccess: () => {
      setDriverId('')
      void qc.invalidateQueries({ queryKey: ['dispatch-route', routeId] })
      void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
    },
  })

  const markDelivered = useMutation({
    mutationFn: (stopId: string) =>
      api.post(`/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/delivered`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dispatch-route', routeId] }),
  })

  const markFailed = useMutation({
    mutationFn: ({ stopId, reason }: { stopId: string; reason?: string }) =>
      api.post(`/routes/${encodeURIComponent(routeId)}/stops/${encodeURIComponent(stopId)}/failed`, {
        reason: reason || undefined,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dispatch-route', routeId] }),
  })

  if (!routeId) return null

  const r = route.data

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
                    Driver: <span className="font-mono text-pleros-text">{r.driverId}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <Card>
            <CardTitle>Assign driver</CardTitle>
            <p className="text-xs text-pleros-muted mt-1">
              Requires tenant admin. Sets route to in progress.
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
            </div>
            {assign.error && <p className="text-red-400 text-xs mt-2">{errMsg(assign.error)}</p>}
          </Card>

          <Card>
            <CardTitle>Stops</CardTitle>
            <p className="text-xs text-pleros-muted mt-1">
              Mark delivered/failed for testing; drivers use `/m/delivery` POD in the field.
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
                      <td className="py-2 pr-4 text-pleros-text max-w-xs truncate" title={formatAddress(s.address)}>
                        {formatAddress(s.address)}
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="py-2 pr-4 align-top">
                        {s.pod?.photoUrl ? (
                          <PodPhoto
                            src={s.pod.photoUrl}
                            caption={
                              s.pod.recipientName
                                ? `Received by ${s.pod.recipientName}`
                                : undefined
                            }
                          />
                        ) : s.status === 'DELIVERED' ? (
                          <span className="text-xs text-pleros-muted">No photo</span>
                        ) : (
                          <span className="text-xs text-pleros-muted">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            disabled={s.status === 'DELIVERED' || markDelivered.isPending}
                            className="text-xs px-2 py-1 rounded border border-pleros-border text-pleros-text disabled:opacity-40"
                            onClick={() => markDelivered.mutate(s.id)}
                          >
                            Delivered
                          </button>
                          <button
                            type="button"
                            disabled={s.status === 'FAILED' || markFailed.isPending}
                            className="text-xs px-2 py-1 rounded border border-pleros-border text-pleros-muted disabled:opacity-40"
                            onClick={() => {
                              const reason = window.prompt('Failure reason (optional)') ?? undefined
                              markFailed.mutate({ stopId: s.id, reason: reason || undefined })
                            }}
                          >
                            Failed
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(markDelivered.error || markFailed.error) && (
              <p className="text-red-400 text-xs mt-2">
                {errMsg(markDelivered.error ?? markFailed.error)}
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
