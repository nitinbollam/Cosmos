import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/cosmos/status-badge'

type TaskDetail = {
  id: string
  orderId: string
  status: string
  priority: string
  warehouseCode: string
  warehouseId?: string
  correlationId?: string
  assignedUserId?: string | null
  pickItems: {
    id: string
    skuId: string
    warehouseId: string
    quantity: number
    pickedQty: number
    status: string
  }[]
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

export default function FulfillmentTaskDetailPage() {
  const params = useParams<{ taskId: string }>()
  const taskId = decodeURIComponent(params?.taskId ?? '')
  const qc = useQueryClient()
  const [assignPick, setAssignPick] = useState('')

  const task = useQuery<TaskDetail>({
    queryKey: ['wms', 'task', taskId],
    queryFn: () => api.get<TaskDetail>(`/wms/tasks/${encodeURIComponent(taskId)}`),
    enabled: Boolean(taskId),
  })

  const users = useQuery<{ items: UserRow[] }>({
    queryKey: ['users', 'fulfillment-task'],
    queryFn: () => api.get('/users?pageSize=200'),
    enabled: Boolean(taskId),
  })

  const assignMut = useMutation({
    mutationFn: (userId: string | null) =>
      api.patch(`/wms/tasks/${encodeURIComponent(taskId)}/assign`, { userId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'task', taskId] })
      void qc.invalidateQueries({ queryKey: ['wms', 'tasks'] })
    },
  })

  const packReq = useMutation({
    mutationKey: ['wms', 'pack', taskId],
    mutationFn: () =>
      api.post<{ status?: string; taskId?: string }>(
        `/fulfillment/tasks/${encodeURIComponent(taskId)}/pack`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'tasks'] })
      void qc.invalidateQueries({ queryKey: ['wms', 'task', taskId] })
    },
  })

  const dispatchReq = useMutation({
    mutationKey: ['wms', 'dispatch', taskId],
    mutationFn: () =>
      api.post<{ status?: string; taskId?: string }>(
        `/fulfillment/tasks/${encodeURIComponent(taskId)}/dispatch`,
        {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'tasks'] })
      void qc.invalidateQueries({ queryKey: ['wms', 'task', taskId] })
    },
  })

  const t = task.data

  useEffect(() => {
    if (!t) return
    setAssignPick(t.assignedUserId ?? '')
  }, [t])
  const packingReady =
    t &&
    t.pickItems.length > 0 &&
    t.pickItems.every((p) => p.status === 'PICKED' || p.status === 'SHORT')

  return (
    <div className="p-6 space-y-4">
      <Link to="/admin/fulfillment" className="text-xs text-cosmos-muted hover:text-cosmos-text">
        ← Tasks
      </Link>
      <h1 className="text-2xl font-bold text-cosmos-white">Fulfillment · task</h1>
      {!taskId ? (
        <p className="text-sm text-red-400">Missing task id.</p>
      ) : task.error ? (
        <p className="text-sm text-red-400">{errMsg(task.error)}</p>
      ) : null}
      {task.isLoading ? <p className="text-cosmos-muted text-sm">Loading…</p> : null}

      {t ? (
        <div className="space-y-4">
          <Card>
            <CardTitle className="font-mono text-xs truncate">{t.id}</CardTitle>
            <div className="mt-2 text-sm space-y-2 text-cosmos-muted">
              <div className="flex flex-wrap items-center gap-2">
                <span>Status</span>
                <StatusBadge status={t.status} />
              </div>
              <div>
                Order{' '}
                <Link
                  to={`/orders/${encodeURIComponent(t.orderId)}`}
                  className="font-mono text-cosmos-primary hover:underline"
                >
                  {t.orderId}
                </Link>
              </div>
              <div>Warehouse {t.warehouseCode}</div>
              {t.correlationId ? (
                <div className="font-mono text-[11px] text-cosmos-muted/90">Correlation {t.correlationId}</div>
              ) : null}
            </div>

            <div className="mt-4 pt-4 border-t border-cosmos-border">
              <p className="text-xs text-cosmos-muted mb-2">Assign picker (optional)</p>
              <div className="flex flex-wrap gap-2 items-center max-w-xl">
                <select
                  className="flex-1 min-w-[200px] rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
                  value={assignPick}
                  onChange={(e) => setAssignPick(e.target.value)}
                  disabled={t.status === 'CANCELLED' || t.status === 'DISPATCHED'}
                >
                  <option value="">Unassigned</option>
                  {(users.data?.items ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {userLabel(u)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={
                    assignMut.isPending || t.status === 'CANCELLED' || t.status === 'DISPATCHED'
                  }
                  onClick={() => assignMut.mutate(assignPick.trim() || null)}
                  className="h-10 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
                >
                  {assignMut.isPending ? 'Saving…' : 'Save assignee'}
                </button>
              </div>
              {t.assignedUserId && (
                <p className="text-xs text-cosmos-muted mt-2 font-mono">
                  Current: {t.assignedUserId}
                </p>
              )}
              {assignMut.error ? (
                <p className="text-xs text-red-400 mt-2">{errMsg(assignMut.error)}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                disabled={packReq.isPending || t.status === 'PACKED' || t.status === 'DISPATCHED'}
                title={
                  packingReady
                    ? 'Mark PACKED'
                    : 'Every line must be PICKED or SHORT (update picks via mobile / sync first)'
                }
                onClick={() => void packReq.mutateAsync()}
                className="h-9 px-3 rounded-md bg-emerald-900/60 border border-emerald-700/70 text-emerald-100 text-xs disabled:opacity-40 hover:bg-emerald-800/70"
              >
                {packReq.isPending ? 'Packing…' : 'Pack'}
              </button>
              <button
                type="button"
                disabled={dispatchReq.isPending || t.status !== 'PACKED'}
                title="Requires PACKED"
                onClick={() => void dispatchReq.mutateAsync()}
                className="h-9 px-3 rounded-md bg-sky-900/60 border border-sky-700/70 text-sky-100 text-xs disabled:opacity-40 hover:bg-sky-800/70"
              >
                {dispatchReq.isPending ? 'Dispatching…' : 'Dispatch'}
              </button>
            </div>
            {packReq.error ? <p className="text-xs text-red-400 mt-2">{errMsg(packReq.error)}</p> : null}
            {dispatchReq.error ? (
              <p className="text-xs text-red-400 mt-2">{errMsg(dispatchReq.error)}</p>
            ) : null}
            {!packingReady && ['PENDING', 'PICKING'].includes(t.status) ? (
              <p className="text-xs text-amber-300/90 mt-2">
                Pack is disabled until all pick lines reach PICKED or SHORT (typically via warehouse handheld).
              </p>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Pick lines</CardTitle>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                    <th className="pb-2 pr-3 font-medium">Line</th>
                    <th className="pb-2 pr-3 font-medium">SKU</th>
                    <th className="pb-2 pr-3 font-medium">Qty</th>
                    <th className="pb-2 pr-3 font-medium">Picked</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {t.pickItems.map((p) => (
                    <tr key={p.id} className="border-b border-cosmos-border/60">
                      <td className="py-2 pr-3 font-mono text-[11px]">{p.id.slice(0, 8)}…</td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-cosmos-text">{p.skuId}</td>
                      <td className="py-2 pr-3">{p.quantity}</td>
                      <td className="py-2 pr-3">{p.pickedQty}</td>
                      <td className="py-2">
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
