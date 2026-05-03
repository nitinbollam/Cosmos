'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'

type RouteStop = { id: string; sequence: number; status: string; address: unknown }
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

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

export default function DispatchRoutesPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)

  const routes = useQuery<DeliveryRoute[]>({
    queryKey: ['dispatch-routes'],
    queryFn: () => api.get('/routes'),
  })

  const users = useQuery<{ items: UserRow[] }>({
    queryKey: ['users', 'dispatch'],
    queryFn: () => api.get('/users?pageSize=200'),
  })

  const assign = useMutation({
    mutationFn: ({ routeId, driverId }: { routeId: string; driverId: string }) =>
      api.patch(`/routes/${encodeURIComponent(routeId)}/driver`, { driverId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['dispatch-routes'] }),
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white">Dispatch</h1>
          <p className="text-cosmos-muted text-sm mt-1">
            Routes from <span className="font-mono">dispatch-service</span>. Drivers use mobile-delivery for stops
            and POD.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
        >
          New route
        </button>
      </div>

      <Card>
        <CardTitle>Routes</CardTitle>
        {routes.isLoading ? (
          <p className="mt-4 text-cosmos-muted text-sm">Loading…</p>
        ) : routes.error ? (
          <p className="mt-4 text-red-400 text-sm">Could not load routes.</p>
        ) : (routes.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="🚗"
            title="No routes"
            description="Create a route with at least one stop. Assign a driver when ready (tenant admin)."
            action={
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
              >
                New route
              </button>
            }
          />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Stops</th>
                  <th className="pb-2 pr-4">Driver</th>
                  <th className="pb-2 pr-4">Assign</th>
                  <th className="pb-2"> </th>
                </tr>
              </thead>
              <tbody>
                {(routes.data ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-cosmos-border/60">
                    <td className="py-2 pr-4 text-cosmos-white">
                      <Link href={`/dispatch/${r.id}`} className="hover:text-cosmos-primary">
                        {r.name?.trim() || 'Route'}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 pr-4 text-cosmos-muted">{r.stops?.length ?? 0}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-cosmos-muted max-w-[140px] truncate">
                      {r.driverId ?? '—'}
                    </td>
                    <td className="py-2 pr-4">
                      <AssignDriverSelect
                        disabled={
                          assign.isPending ||
                          r.status === 'COMPLETED' ||
                          r.status === 'CANCELLED'
                        }
                        users={(users.data?.items ?? []) as UserRow[]}
                        onAssign={(driverId) => assign.mutate({ routeId: r.id, driverId })}
                      />
                    </td>
                    <td className="py-2">
                      <Link href={`/dispatch/${r.id}`} className="text-cosmos-primary text-xs whitespace-nowrap">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {assign.error && <p className="text-red-400 text-xs mt-3">{errMsg(assign.error)}</p>}
      </Card>

      {createOpen && (
        <CreateRouteDrawer
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            void qc.invalidateQueries({ queryKey: ['dispatch-routes'] })
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
    <div className="flex items-center gap-1 max-w-[200px]">
      <select
        className="flex-1 min-w-0 rounded-md bg-cosmos-surface-2 border border-cosmos-border px-2 py-1 text-xs text-cosmos-text"
        value={v}
        disabled={props.disabled}
        onChange={(e) => setV(e.target.value)}
      >
        <option value="">Driver…</option>
        {props.users.map((u) => (
          <option key={u.id} value={u.id}>
            {userLabel(u)}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={props.disabled || !v}
        className="shrink-0 px-2 py-1 rounded border border-cosmos-border text-xs text-cosmos-text disabled:opacity-40"
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

function CreateRouteDrawer(props: { onClose: () => void; onCreated: () => void }) {
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
    setBusy(true)
    try {
      await api.post('/routes', {
        name: name.trim() || undefined,
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
        <p className="text-xs text-cosmos-muted mt-1">Stops are ordered; sequence is assigned automatically.</p>
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
