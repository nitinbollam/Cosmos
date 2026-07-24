import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'

type FloorTask = {
  id: string
  orderId: string
  status: string
  priority: string
  warehouseCode: string
  warehouseId?: string
  assignedUserId?: string | null
  createdAt?: string
  pickItems?: { id: string; skuId: string; quantity: number; pickedQty: number; status: string }[]
}

type WarehouseRow = { id: string; name: string; code: string }

/** Maps to WMS listTasksForFloor query semantics (empty = PENDING+PICKING). */
const STATUS_FILTERS: Array<{ label: string; value: string }> = [
  { label: 'Active pickup', value: '' },
  { label: 'All open', value: 'ALL' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'Pending', value: 'PENDING' },
  { label: 'Picking', value: 'PICKING' },
  { label: 'Ready to pack', value: 'PICKED' },
  { label: 'Packed', value: 'PACKED' },
  { label: 'Dispatched', value: 'DISPATCHED' },
]

function buildTasksUrl(status: string, warehouseId: string, orderId: string): string {
  const q = new URLSearchParams()
  if (status) q.set('status', status)
  if (warehouseId.trim()) q.set('warehouseId', warehouseId.trim())
  if (orderId.trim()) q.set('orderId', orderId.trim())
  const qs = q.toString()
  return qs ? `/wms/tasks?${qs}` : '/wms/tasks'
}

export default function FulfillmentTasksPage() {
  const [statusFilter, setStatusFilter] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [orderSearch, setOrderSearch] = useState('')

  const tasksUrl = useMemo(
    () => buildTasksUrl(statusFilter, warehouseId, orderSearch),
    [statusFilter, warehouseId, orderSearch],
  )

  const tasks = useQuery<FloorTask[]>({
    queryKey: ['wms', 'tasks', 'floor', statusFilter, warehouseId, orderSearch],
    queryFn: () => api.get(tasksUrl),
    refetchInterval: 45_000,
  })

  const warehouses = useQuery<WarehouseRow[]>({
    queryKey: ['warehouses', 'fulfillment'],
    queryFn: () => api.get('/warehouses'),
  })

  const rows = tasks.data ?? []

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white">Fulfillment</h1>
          <p className="text-pleros-muted text-sm mt-1">
            WMS floor tasks (<span className="font-mono">/wms/tasks</span>). Open a task to pack or dispatch after
            picks complete.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void tasks.refetch()}
          className="h-9 px-3 rounded-md border border-pleros-border text-xs text-pleros-text hover:bg-pleros-surface-2"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
              statusFilter === f.value
                ? 'border-pleros-primary bg-pleros-primary/20 text-pleros-white'
                : 'border-pleros-border text-pleros-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-pleros-muted mb-1">Warehouse</label>
          <select
            className="rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text min-w-[180px]"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">All</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px] max-w-md">
          <label className="block text-xs text-pleros-muted mb-1">Order ID</label>
          <input
            className="w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text font-mono"
            placeholder="Filter by order id…"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardTitle>Pick tasks</CardTitle>
        {tasks.isLoading ? (
          <p className="text-pleros-muted text-sm mt-3">Loading…</p>
        ) : tasks.isError ? (
          <p className="text-red-400 text-sm mt-3">Could not load tasks.</p>
        ) : rows.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              icon="📋"
              title="No tasks in this view"
              description="Adjust filters, or wait for orders to create WMS fulfillment tasks from the saga."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-pleros-muted border-b border-pleros-border">
                  <th className="pb-2 pr-4 font-medium">Task</th>
                  <th className="pb-2 pr-4 font-medium">Order</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">WH</th>
                  <th className="pb-2 pr-4 font-medium">Assignee</th>
                  <th className="pb-2 pr-4 font-medium">Lines</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-pleros-border/60 hover:bg-pleros-surface-2/40">
                    <td className="py-2 pr-4">
                      <Link
                        to={adminPath(`/fulfillment/${encodeURIComponent(t.id)}`)}
                        className="font-mono text-xs text-pleros-primary hover:underline"
                      >
                        {t.id.slice(0, 10)}…
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <Link
                        to={adminPath(`/orders/${encodeURIComponent(t.orderId)}`)}
                        className="font-mono text-xs text-pleros-muted hover:text-pleros-primary"
                      >
                        {t.orderId.slice(0, 12)}…
                      </Link>
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="py-2 pr-4 text-pleros-muted text-xs">{t.warehouseCode}</td>
                    <td className="py-2 pr-4 font-mono text-[11px] text-pleros-muted">
                      {t.assignedUserId ? `${t.assignedUserId.slice(0, 8)}…` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-pleros-muted text-xs">{t.pickItems?.length ?? '—'}</td>
                    <td className="py-2 text-pleros-muted text-xs whitespace-nowrap">
                      {t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
