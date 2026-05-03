'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'

type Tab = 'picks' | 'receiving' | 'counts'

type PickTask = {
  id: string
  orderId: string
  status: string
  priority: string
  warehouseCode: string
  warehouseId: string
  assignedUserId: string | null
  createdAt: string
  pickItems: { id: string; skuId: string; quantity: number; pickedQty: number; status: string }[]
}

type WarehouseRow = { id: string; name: string; code: string }

type ReceivingRow = {
  id: string
  warehouseId: string
  poId: string | null
  status: string
  startedBy: string
  createdAt: string
  _count: { items: number }
}

type ReceivingDetail = ReceivingRow & {
  items: Array<{
    id: string
    skuId: string
    receivedQty: number
    damagedQty: number
    batchId: string | null
    barcode: string | null
  }>
}

type CycleRow = {
  id: string
  warehouseId: string
  type: string
  status: string
  scheduledFor: string | null
  createdBy: string
  createdAt: string
  _count: { lines: number }
}

type CycleDetail = Omit<CycleRow, '_count'> & {
  lines: Array<{
    id: string
    skuId: string
    locationLabel: string | null
    systemQty: number
    countedQty: number | null
  }>
}


function pickProgress(task: PickTask) {
  const items = task.pickItems ?? []
  const total = items.length
  const picked = items.filter((i) => i.pickedQty >= i.quantity || i.status === 'PICKED' || i.status === 'SHORT').length
  return { picked, total }
}

function priorityBorder(p: string): string {
  switch (p?.toUpperCase()) {
    case 'URGENT':
      return 'var(--c-danger)'
    case 'HIGH':
      return 'var(--c-warning)'
    case 'LOW':
      return 'var(--c-text-3)'
    default:
      return 'var(--c-primary)'
  }
}

export default function WarehousePage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('picks')
  const [pickStatus, setPickStatus] = useState<string>('ALL')
  const [pickWarehouseId, setPickWarehouseId] = useState<string>('')

  const [assignTaskId, setAssignTaskId] = useState<string | null>(null)
  const [assignUserId, setAssignUserId] = useState<string>('')

  const [detailTask, setDetailTask] = useState<PickTask | null>(null)

  const [recvDrawer, setRecvDrawer] = useState(false)
  const [recvWh, setRecvWh] = useState('')
  const [recvPo, setRecvPo] = useState('')

  const [recvDetailId, setRecvDetailId] = useState<string | null>(null)

  const [countDrawer, setCountDrawer] = useState(false)
  const [countWh, setCountWh] = useState('')
  const [countType, setCountType] = useState<'FULL' | 'ABC' | 'RANDOM'>('FULL')
  const [countScheduled, setCountScheduled] = useState('')
  const [countDetailId, setCountDetailId] = useState<string | null>(null)

  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseRow[]>('/warehouses'),
  })

  const usersQ = useQuery({
    queryKey: ['users', 'warehouse-assign'],
    queryFn: () =>
      api.get<{
        items: Array<{
          id: string
          firstName: string | null
          lastName: string | null
          email: string
          role: string
          isActive?: boolean
        }>
      }>('/users?page=1&pageSize=200'),
  })

  const userLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usersQ.data?.items ?? []) {
      const n = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
      m.set(u.id, n)
    }
    return m
  }, [usersQ.data])

  const warehouseLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const w of warehousesQ.data ?? []) {
      m.set(w.id, `${w.code} · ${w.name}`)
    }
    return m
  }, [warehousesQ.data])

  const pickQs = [
    'ALL',
    'PENDING',
    'ASSIGNED',
    'PICKING',
    'PICKED',
    'PACKING',
    'PACKED',
    'DISPATCHED',
  ]
  const pickQueryStatus = pickStatus === 'ALL' ? 'ALL' : pickStatus

  const tasksQ = useQuery({
    queryKey: ['wms', 'tasks', pickQueryStatus, pickWarehouseId],
    enabled: tab === 'picks',
    queryFn: async () => {
      const q = new URLSearchParams()
      q.set('status', pickQueryStatus)
      if (pickWarehouseId) q.set('warehouseId', pickWarehouseId)
      return api.get<PickTask[]>(`/wms/tasks?${q.toString()}`)
    },
  })

  const sessionsQ = useQuery({
    queryKey: ['wms', 'receiving', 'sessions'],
    enabled: tab === 'receiving',
    queryFn: () => api.get<ReceivingRow[]>('/wms/receiving/sessions'),
  })

  const recvDetailQ = useQuery({
    queryKey: ['wms', 'receiving', recvDetailId],
    enabled: !!recvDetailId,
    queryFn: () => api.get<ReceivingDetail>(`/wms/receiving/sessions/${recvDetailId}`),
  })

  const countsQ = useQuery({
    queryKey: ['wms', 'cycle-counts'],
    enabled: tab === 'counts',
    queryFn: () => api.get<CycleRow[]>('/wms/cycle-counts'),
  })

  const countDetailQ = useQuery({
    queryKey: ['wms', 'cycle-counts', countDetailId],
    enabled: !!countDetailId,
    queryFn: () => api.get<CycleDetail>(`/wms/cycle-counts/${countDetailId}`),
  })

  const assignMut = useMutation({
    mutationFn: async ({ taskId, userId }: { taskId: string; userId: string | null }) => {
      await api.patch(`/wms/tasks/${encodeURIComponent(taskId)}/assign`, { userId })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'tasks'] })
      setAssignTaskId(null)
      setAssignUserId('')
    },
  })

  const startRecvMut = useMutation({
    mutationFn: async () => {
      await api.post('/wms/receiving/sessions', {
        warehouseId: recvWh,
        ...(recvPo.trim() ? { poId: recvPo.trim() } : {}),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'receiving', 'sessions'] })
      setRecvDrawer(false)
      setRecvWh('')
      setRecvPo('')
    },
  })

  const completeRecvMut = useMutation({
    mutationFn: async (sessionId: string) => {
      await api.patch(`/wms/receiving/sessions/${encodeURIComponent(sessionId)}/complete`, {
        notes: '',
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'receiving'] })
      setRecvDetailId(null)
    },
  })

  const createCountMut = useMutation({
    mutationFn: async () => {
      await api.post('/wms/cycle-counts', {
        warehouseId: countWh,
        type: countType,
        ...(countScheduled ? { scheduledFor: new Date(countScheduled).toISOString() } : {}),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'cycle-counts'] })
      setCountDrawer(false)
      setCountWh('')
      setCountScheduled('')
    },
  })

  const submitCountMut = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/wms/cycle-counts/${encodeURIComponent(id)}/submit-for-approval`, {})
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'cycle-counts'] })
      void countDetailQ.refetch()
    },
  })

  const approveCountMut = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/wms/cycle-counts/${encodeURIComponent(id)}/approve`, {})
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'cycle-counts'] })
      setCountDetailId(null)
    },
  })

  const staffUsers = useMemo(
    () =>
      (usersQ.data?.items ?? []).filter(
        (u) => u.role === 'WAREHOUSE_STAFF' && u.isActive !== false,
      ),
    [usersQ.data],
  )

  const allRecvRows = sessionsQ.data ?? []

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cosmos-white" style={{ fontFamily: 'var(--font-display)' }}>
          Warehouse
        </h1>
        <p className="text-cosmos-text-3 text-sm mt-1">Pick tasks, receiving, and cycle counts</p>
      </div>

      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
        {(
          [
            ['picks', 'Pick tasks'],
            ['receiving', 'Receiving'],
            ['counts', 'Cycle counts'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{
              background: tab === k ? 'var(--c-primary-dim)' : 'transparent',
              color: tab === k ? 'var(--c-white)' : 'var(--c-text-2)',
              border: tab === k ? '1px solid var(--c-primary)' : '1px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'picks' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>
                Status
              </div>
              <select
                className="cosmos-input w-auto min-w-[160px]"
                value={pickStatus}
                onChange={(e) => setPickStatus(e.target.value)}
              >
                {pickQs.map((s) => (
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
                className="cosmos-input w-auto min-w-[200px]"
                value={pickWarehouseId}
                onChange={(e) => setPickWarehouseId(e.target.value)}
              >
                <option value="">All warehouses</option>
                {(warehousesQ.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="cosmos-card overflow-x-auto">
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
              <table className="cosmos-table">
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
                    return (
                      <tr
                        key={t.id}
                        className="cursor-pointer"
                        style={{ borderLeft: `4px solid ${priorityBorder(t.priority)}` }}
                        onClick={() => setDetailTask(t)}
                      >
                        <td className="font-mono text-sm">#{t.id.slice(-8)}</td>
                        <td className="font-mono text-sm" style={{ color: 'var(--c-text-2)' }}>
                          …{t.orderId.slice(-10)}
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
        </div>
      )}

      {tab === 'receiving' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={() => setRecvDrawer(true)}>
              New session
            </button>
          </div>
          <div className="cosmos-card overflow-x-auto">
            {sessionsQ.isLoading ? (
              <div className="space-y-2 py-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-12 w-full" />
                ))}
              </div>
            ) : sessionsQ.isError ? (
              <p className="text-sm py-8" style={{ color: 'var(--c-danger)' }}>
                {(sessionsQ.error as Error)?.message ?? 'Failed to load sessions'}
              </p>
            ) : allRecvRows.length === 0 ? (
              <EmptyState
                icon="📥"
                title="No receiving sessions"
                description="Start a session to scan goods against a PO."
                action={
                  <button type="button" className="btn-primary mt-2" onClick={() => setRecvDrawer(true)}>
                    New session
                  </button>
                }
              />
            ) : (
              <table className="cosmos-table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Warehouse</th>
                    <th>PO</th>
                    <th>Status</th>
                    <th>Scanned</th>
                    <th>Started by</th>
                    <th>Started</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {allRecvRows.map((s) => (
                    <tr key={s.id} className="cursor-pointer" onClick={() => setRecvDetailId(s.id)}>
                      <td className="font-mono">#{s.id.slice(-8)}</td>
                      <td className="text-sm">{warehouseLabel.get(s.warehouseId) ?? s.warehouseId.slice(-6)}</td>
                      <td className="font-mono text-sm">{s.poId ? `#${s.poId.slice(-8)}` : '—'}</td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td>{s._count?.items ?? 0}</td>
                      <td className="font-mono text-xs" style={{ color: 'var(--c-text-2)' }}>
                        {s.startedBy.slice(-8)}
                      </td>
                      <td className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                        {new Date(s.createdAt).toLocaleString()}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {(s.status === 'OPEN' || s.status === 'IN_PROGRESS') && (
                          <button
                            type="button"
                            className="btn-primary !py-1.5 !px-2 !text-xs"
                            disabled={completeRecvMut.isPending}
                            onClick={() => {
                              if ((s._count?.items ?? 0) < 1) {
                                alert('Scan at least one item before completing.')
                                return
                              }
                              completeRecvMut.mutate(s.id)
                            }}
                          >
                            Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'counts' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={() => setCountDrawer(true)}>
              New count
            </button>
          </div>
          <div className="cosmos-card overflow-x-auto">
            {countsQ.isLoading ? (
              <div className="space-y-2 py-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-12 w-full" />
                ))}
              </div>
            ) : countsQ.isError ? (
              <p className="text-sm py-8" style={{ color: 'var(--c-danger)' }}>
                {(countsQ.error as Error)?.message ?? 'Failed to load cycle counts'}
              </p>
            ) : (countsQ.data ?? []).length === 0 ? (
              <EmptyState
                icon="🔢"
                title="No cycle counts"
                description="Schedule wall-to-wall or sample counts to keep inventory accurate."
                action={
                  <button type="button" className="btn-primary mt-2" onClick={() => setCountDrawer(true)}>
                    New count
                  </button>
                }
              />
            ) : (
              <table className="cosmos-table">
                <thead>
                  <tr>
                    <th>Count</th>
                    <th>Warehouse</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Items</th>
                    <th>Scheduled</th>
                    <th>Created by</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(countsQ.data ?? []).map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono">#{c.id.slice(-8)}</td>
                      <td className="text-sm">{warehouseLabel.get(c.warehouseId) ?? c.warehouseId.slice(-6)}</td>
                      <td>{c.type}</td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                      <td>{c._count?.lines ?? 0}</td>
                      <td className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                        {c.scheduledFor ? new Date(c.scheduledFor).toLocaleDateString() : '—'}
                      </td>
                      <td className="font-mono text-xs">{c.createdBy.slice(-8)}</td>
                      <td>
                        <button type="button" className="btn-ghost !py-1.5 !px-2 !text-xs" onClick={() => setCountDetailId(c.id)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Assign modal */}
      {assignTaskId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setAssignTaskId(null)}
        >
          <div className="cosmos-card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-4">Assign pick task</h3>
            <label className="block text-sm mb-2" style={{ color: 'var(--c-text-2)' }}>
              Warehouse staff
            </label>
            <select className="cosmos-input mb-4" value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}>
              <option value="">Unassigned</option>
              {staffUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setAssignTaskId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={assignMut.isPending}
                onClick={() =>
                  assignMut.mutate({
                    taskId: assignTaskId,
                    userId: assignUserId || null,
                  })
                }
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task detail */}
      {detailTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setDetailTask(null)}
        >
          <div className="cosmos-card max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-cosmos-white font-display">Pick task #{detailTask.id.slice(-8)}</h3>
                <p className="text-sm mt-1 font-mono" style={{ color: 'var(--c-text-3)' }}>
                  Order …{detailTask.orderId.slice(-12)}
                </p>
              </div>
              <StatusBadge status={detailTask.status} />
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--c-text-2)' }}>
              {detailTask.warehouseCode} · Priority {detailTask.priority}
            </p>
            <table className="cosmos-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>SKU</th>
                  <th>Required</th>
                  <th>Picked</th>
                  <th>Line status</th>
                </tr>
              </thead>
              <tbody>
                {(detailTask.pickItems ?? []).map((p, idx) => (
                  <tr key={p.id}>
                    <td>{idx + 1}</td>
                    <td className="font-mono text-sm">{p.skuId.slice(-12)}</td>
                    <td>{p.quantity}</td>
                    <td>{p.pickedQty}</td>
                    <td>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex justify-end">
              <button type="button" className="btn-ghost" onClick={() => setDetailTask(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New receiving drawer */}
      {recvDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setRecvDrawer(false)}>
          <div className="w-full max-w-md h-full overflow-y-auto cosmos-card rounded-none border-l" style={{ borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-4">New receiving session</h3>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              Warehouse
            </label>
            <select className="cosmos-input mb-4" value={recvWh} onChange={(e) => setRecvWh(e.target.value)}>
              <option value="">Select…</option>
              {(warehousesQ.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              PO id (optional)
            </label>
            <input className="cosmos-input mb-4" value={recvPo} onChange={(e) => setRecvPo(e.target.value)} placeholder="Purchase order id" />
            <button
              type="button"
              className="btn-primary w-full"
              disabled={!recvWh || startRecvMut.isPending}
              onClick={() => startRecvMut.mutate()}
            >
              Start session
            </button>
          </div>
        </div>
      )}

      {/* Receiving detail */}
      {recvDetailId && recvDetailQ.data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setRecvDetailId(null)}
        >
          <div className="cosmos-card max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start gap-4 mb-2">
              <div>
                <h3 className="text-lg font-semibold text-cosmos-white font-display">Session #{recvDetailQ.data.id.slice(-8)}</h3>
                <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                  {warehouseLabel.get(recvDetailQ.data.warehouseId)}
                </p>
              </div>
              <StatusBadge status={recvDetailQ.data.status} />
            </div>
            {recvDetailQ.data.poId && (
              <p className="text-sm font-mono mb-4" style={{ color: 'var(--c-accent)' }}>
                PO #{recvDetailQ.data.poId.slice(-12)}
              </p>
            )}
            <table className="cosmos-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Received</th>
                  <th>Damaged</th>
                  <th>Batch</th>
                </tr>
              </thead>
              <tbody>
                {(recvDetailQ.data.items ?? []).map((it) => (
                  <tr key={it.id}>
                    <td className="font-mono text-sm">{it.skuId.slice(-12)}</td>
                    <td>{it.receivedQty}</td>
                    <td>{it.damagedQty}</td>
                    <td className="font-mono text-xs">{it.batchId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setRecvDetailId(null)}>
                Close
              </button>
              {(recvDetailQ.data.status === 'OPEN' || recvDetailQ.data.status === 'IN_PROGRESS') && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={completeRecvMut.isPending || (recvDetailQ.data.items?.length ?? 0) < 1}
                  onClick={() => {
                    if ((recvDetailQ.data.items?.length ?? 0) < 1) {
                      alert('Scan at least one line item before completing.')
                      return
                    }
                    completeRecvMut.mutate(recvDetailQ.data.id)
                  }}
                >
                  Complete session
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New cycle count */}
      {countDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={() => setCountDrawer(false)}>
          <div className="w-full max-w-md h-full overflow-y-auto cosmos-card rounded-none" style={{ borderRadius: 0 }} onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-4">New cycle count</h3>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              Warehouse
            </label>
            <select className="cosmos-input mb-4" value={countWh} onChange={(e) => setCountWh(e.target.value)}>
              <option value="">Select…</option>
              {(warehousesQ.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              Type
            </label>
            <select className="cosmos-input mb-4" value={countType} onChange={(e) => setCountType(e.target.value as 'FULL' | 'ABC' | 'RANDOM')}>
              <option value="FULL">FULL</option>
              <option value="ABC">ABC</option>
              <option value="RANDOM">RANDOM</option>
            </select>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              Scheduled date (optional)
            </label>
            <input type="date" className="cosmos-input mb-4" value={countScheduled} onChange={(e) => setCountScheduled(e.target.value)} />
            <button
              type="button"
              className="btn-primary w-full"
              disabled={!countWh || createCountMut.isPending}
              onClick={() => createCountMut.mutate()}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Cycle detail */}
      {countDetailId && countDetailQ.data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setCountDetailId(null)}
        >
          <div className="cosmos-card max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between gap-4 mb-4 flex-wrap">
              <div>
                <h3 className="text-lg font-semibold text-cosmos-white font-display">Cycle count #{countDetailQ.data.id.slice(-8)}</h3>
                <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                  {warehouseLabel.get(countDetailQ.data.warehouseId)} · {countDetailQ.data.type}
                </p>
              </div>
              <StatusBadge status={countDetailQ.data.status} />
            </div>
            {countDetailQ.data.lines.length === 0 ? (
              <p className="text-sm py-6" style={{ color: 'var(--c-text-3)' }}>
                No count lines yet. Lines are added when the team captures SKU snapshots from the floor (or via integration).
              </p>
            ) : (
              <table className="cosmos-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Location</th>
                    <th>System</th>
                    <th>Counted</th>
                    <th>Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {countDetailQ.data.lines.map((ln) => {
                    const counted = ln.countedQty
                    const varc =
                      counted == null ? '—' : counted - ln.systemQty === 0 ? '0' : String(counted - ln.systemQty)
                    return (
                      <tr key={ln.id}>
                        <td className="font-mono text-sm">{ln.skuId.slice(-12)}</td>
                        <td>{ln.locationLabel ?? '—'}</td>
                        <td>{ln.systemQty}</td>
                        <td>{counted ?? '—'}</td>
                        <td
                          className="font-mono"
                          style={{
                            color:
                              varc === '—' || varc === '0'
                                ? 'var(--c-text-2)'
                                : Number(varc) > 0
                                  ? 'var(--c-success)'
                                  : 'var(--c-danger)',
                          }}
                        >
                          {varc}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            <div className="mt-4 flex flex-wrap gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setCountDetailId(null)}>
                Close
              </button>
              {(countDetailQ.data.status === 'DRAFT' || countDetailQ.data.status === 'IN_PROGRESS') && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={submitCountMut.isPending}
                  onClick={() => submitCountMut.mutate(countDetailQ.data!.id)}
                >
                  Submit for approval
                </button>
              )}
              {countDetailQ.data.status === 'PENDING_APPROVAL' && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={approveCountMut.isPending}
                  onClick={() => approveCountMut.mutate(countDetailQ.data!.id)}
                >
                  Approve & post
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
