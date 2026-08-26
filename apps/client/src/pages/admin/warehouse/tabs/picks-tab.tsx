import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { showToast } from '@/lib/toast'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { PlerosDialogModal, PlerosSheet } from '@/components/pleros/radix-overlays'
import { PickTask, WarehouseRow, pickProgress, priorityBorder } from '../types'

interface PicksTabProps {
  warehouses: WarehouseRow[]
  userLabel: Map<string, string>
  users: Array<{ id: string; firstName: string | null; lastName: string | null; email: string }>
}

const PICK_STATUSES = [
  'ALL',
  'PENDING',
  'ASSIGNED',
  'PICKING',
  'PICKED',
  'PACKING',
  'PACKED',
  'COMPLETED',
  'CANCELLED',
]

export function PicksTab({ warehouses, userLabel, users }: PicksTabProps) {
  const qc = useQueryClient()
  const [pickStatus, setPickStatus] = useState<string>('ALL')
  const [pickWarehouseId, setPickWarehouseId] = useState<string>('')
  const [assignTaskId, setAssignTaskId] = useState<string | null>(null)
  const [assignUserId, setAssignUserId] = useState<string>('')
  const [detailTask, setDetailTask] = useState<PickTask | null>(null)

  const tasksQ = useQuery({
    queryKey: ['pick-tasks', pickStatus, pickWarehouseId],
    queryFn: () => {
      const p = new URLSearchParams()
      if (pickStatus && pickStatus !== 'ALL') p.set('status', pickStatus)
      if (pickWarehouseId) p.set('warehouseId', pickWarehouseId)
      const qs = p.toString()
      return api.get<PickTask[]>(`/fulfillment/tasks${qs ? `?${qs}` : ''}`)
    },
  })

  const assignMut = useMutation({
    mutationFn: (body: { taskId: string; userId: string | null }) =>
      api.patch(`/fulfillment/tasks/${body.taskId}/assign`, { userId: body.userId || null }),
    onSuccess: () => {
      showToast('Assignment updated')
      void qc.invalidateQueries({ queryKey: ['pick-tasks'] })
      setAssignTaskId(null)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>
            Status
          </div>
          <select
            className="pleros-input w-auto min-w-[160px]"
            value={pickStatus}
            onChange={(e) => setPickStatus(e.target.value)}
          >
            {PICK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>
            Warehouse
          </div>
          <select
            className="pleros-input w-auto min-w-[200px]"
            value={pickWarehouseId}
            onChange={(e) => setPickWarehouseId(e.target.value)}
          >
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="pleros-card overflow-x-auto">
        {tasksQ.isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        ) : tasksQ.isError ? (
          <p className="text-sm py-8" style={{ color: 'var(--c-danger)' }}>
            {(tasksQ.error as Error)?.message ?? 'Failed to load tasks'}
          </p>
        ) : (tasksQ.data ?? []).length === 0 ? (
          <EmptyState icon="🏭" title="No pick tasks" description="Tasks appear when orders are released to the warehouse." />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Order</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assigned</th>
                <th>Items</th>
                <th>Progress</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(tasksQ.data ?? []).map((t) => {
                const { picked, total } = pickProgress(t)
                const pct = total > 0 ? Math.round((picked / total) * 100) : 0
                const taskCode = t.id.startsWith('seed_tsk_')
                  ? `TSK-${t.id.replace('seed_tsk_', '').toUpperCase()}`
                  : `TSK-${t.id.slice(-6).toUpperCase()}`
                const orderCode = t.orderId.startsWith('seed_ord_')
                  ? `ORD-${t.orderId.replace('seed_ord_', '').toUpperCase()}`
                  : `ORD-${t.orderId.slice(-6).toUpperCase()}`
                return (
                  <tr
                    key={t.id}
                    className="cursor-pointer"
                    style={{ borderLeft: `4px solid ${priorityBorder(t.priority)}` }}
                    onClick={() => setDetailTask(t)}
                  >
                    <td className="font-mono text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>
                      #{taskCode}
                    </td>
                    <td className="font-mono text-sm" style={{ color: 'var(--c-text-2)' }}>
                      #{orderCode}
                    </td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td>
                      <span className="text-xs font-semibold" style={{ color: priorityBorder(t.priority) }}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="text-sm">
                      {t.assignedUserId ? userLabel.get(t.assignedUserId) ?? t.assignedUserId.slice(-6) : '—'}
                    </td>
                    <td>{total}</td>
                    <td className="min-w-[120px]">
                      <div className="text-xs mb-1" style={{ color: 'var(--c-text-3)' }}>
                        {picked}/{total}
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-surface-2)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--c-primary)' }} />
                      </div>
                    </td>
                    <td className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn-ghost !py-1.5 !px-2 !text-xs"
                        onClick={() => {
                          setAssignTaskId(t.id)
                          setAssignUserId(t.assignedUserId ?? '')
                        }}
                      >
                        Assign
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <PlerosDialogModal
        open={Boolean(assignTaskId)}
        onOpenChange={(o) => !o && setAssignTaskId(null)}
        title="Assign picker"
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
            Choose a warehouse operator for task{' '}
            <span className="font-mono">{assignTaskId ? `#${assignTaskId.slice(-8)}` : ''}</span>.
          </p>
          <div>
            <label className="text-xs uppercase tracking-wider block mb-1" style={{ color: 'var(--c-text-3)' }}>
              Operator
            </label>
            <select className="pleros-input" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => {
                const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
                return (
                  <option key={u.id} value={u.id}>
                    {name}
                  </option>
                )
              })}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-ghost" onClick={() => setAssignTaskId(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={assignMut.isPending}
              onClick={() => {
                if (!assignTaskId) return
                assignMut.mutate({ taskId: assignTaskId, userId: assignUserId || null })
              }}
            >
              {assignMut.isPending ? 'Saving…' : 'Save assignment'}
            </button>
          </div>
        </div>
      </PlerosDialogModal>

      <PlerosSheet
        open={Boolean(detailTask)}
        onOpenChange={(o) => !o && setDetailTask(null)}
        title={`Pick Task #${detailTask?.id.slice(-8) ?? ''}`}
      >
        {detailTask && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <StatusBadge status={detailTask.status} />
              <span className="font-mono text-xs" style={{ color: 'var(--c-text-3)' }}>
                {detailTask.warehouseCode}
              </span>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                Order
              </div>
              <Link to={adminPath(`/orders/${detailTask.orderId}`)} className="text-primary font-mono hover:underline">
                {detailTask.orderId}
              </Link>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>
                Pick lines ({detailTask.pickItems?.length ?? 0})
              </div>
              <div className="space-y-2">
                {(detailTask.pickItems ?? []).map((pi) => (
                  <div
                    key={pi.id}
                    className="p-3 rounded-lg border flex items-center justify-between"
                    style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface-2)' }}
                  >
                    <div>
                      <div className="font-mono font-semibold">{pi.skuId}</div>
                      <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                        Status: {pi.status}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">
                        {pi.pickedQty} / {pi.quantity}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                        picked
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </PlerosSheet>
    </div>
  )
}
