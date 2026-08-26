import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { showToast } from '@/lib/toast'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { PlerosSheet } from '@/components/pleros/radix-overlays'
import { PickTask, PickWaveRow, WarehouseRow, priorityBorder } from '../types'

interface WavesTabProps {
  warehouses: WarehouseRow[]
  warehouseLabel: Map<string, string>
}

export function WavesTab({ warehouses, warehouseLabel }: WavesTabProps) {
  const qc = useQueryClient()
  const [waveWarehouseId, setWaveWarehouseId] = useState<string>('')
  const [waveDrawerOpen, setWaveDrawerOpen] = useState(false)
  const [waveTaskSelection, setWaveTaskSelection] = useState<Set<string>>(new Set())
  const [wavePathId, setWavePathId] = useState<string | null>(null)

  const wavesQ = useQuery({
    queryKey: ['pick-waves', waveWarehouseId],
    queryFn: () => {
      const q = waveWarehouseId ? `?warehouseId=${encodeURIComponent(waveWarehouseId)}` : ''
      return api.get<PickWaveRow[]>(`/pick-waves${q}`)
    },
  })

  const waveEligibleTasksQ = useQuery({
    queryKey: ['pick-tasks', 'wave-eligible', waveWarehouseId],
    queryFn: () =>
      api.get<PickTask[]>(`/fulfillment/tasks?status=PENDING&warehouseId=${encodeURIComponent(waveWarehouseId)}`),
    enabled: Boolean(waveWarehouseId) && waveDrawerOpen,
  })

  const wavePathQ = useQuery({
    queryKey: ['pick-wave-path', wavePathId],
    queryFn: () => api.get<{ pickPath: Array<{ lineId: string; binCode: string | null; skuId: string; quantity: number; orderId: string; status: string }> }>(`/pick-waves/${wavePathId}/path`),
    enabled: Boolean(wavePathId),
  })

  const createWaveMut = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/pick-waves', {
        warehouseId: waveWarehouseId,
        taskIds: Array.from(waveTaskSelection),
      }),
    onSuccess: (res) => {
      showToast(`Wave #${res.id.slice(-8)} created`)
      setWaveDrawerOpen(false)
      setWaveTaskSelection(new Set())
      void qc.invalidateQueries({ queryKey: ['pick-waves'] })
      void qc.invalidateQueries({ queryKey: ['pick-tasks'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const startWaveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/pick-waves/${id}/start`),
    onSuccess: () => {
      showToast('Wave started')
      void qc.invalidateQueries({ queryKey: ['pick-waves'] })
      void qc.invalidateQueries({ queryKey: ['pick-tasks'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const completeWaveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/pick-waves/${id}/complete`),
    onSuccess: () => {
      showToast('Wave completed')
      void qc.invalidateQueries({ queryKey: ['pick-waves'] })
      void qc.invalidateQueries({ queryKey: ['pick-tasks'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>
            Warehouse
          </div>
          <select
            className="pleros-input w-auto min-w-[200px]"
            value={waveWarehouseId}
            onChange={(e) => setWaveWarehouseId(e.target.value)}
          >
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!waveWarehouseId}
          onClick={() => {
            setWaveTaskSelection(new Set())
            setWaveDrawerOpen(true)
          }}
        >
          New pick wave
        </button>
      </div>

      <div className="pleros-card overflow-x-auto">
        {wavesQ.isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        ) : wavesQ.isError ? (
          <p className="text-sm py-8" style={{ color: 'var(--c-danger)' }}>
            {(wavesQ.error as Error)?.message ?? 'Failed to load pick waves'}
          </p>
        ) : (wavesQ.data ?? []).length === 0 ? (
          <EmptyState
            icon="🌊"
            title="No pick waves"
            description="Group pending pick tasks into a wave for batch picking on the floor."
            action={
              waveWarehouseId ? (
                <button type="button" className="btn-primary mt-2" onClick={() => setWaveDrawerOpen(true)}>
                  New pick wave
                </button>
              ) : undefined
            }
          />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Wave</th>
                <th>Warehouse</th>
                <th>Status</th>
                <th>Tasks</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(wavesQ.data ?? []).map((w) => (
                <tr key={w.id}>
                  <td className="font-mono text-sm">#{w.id.slice(-8)}</td>
                  <td className="text-sm">{warehouseLabel.get(w.warehouseId) ?? w.warehouseId.slice(-6)}</td>
                  <td>
                    <StatusBadge status={w.status} />
                  </td>
                  <td>{w.tasks?.length ?? 0}</td>
                  <td className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                    {new Date(w.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-ghost !py-1.5 !px-2 !text-xs"
                        onClick={() => setWavePathId((cur) => (cur === w.id ? null : w.id))}
                      >
                        {wavePathId === w.id ? 'Hide path' : 'Pick path'}
                      </button>
                      {w.status === 'OPEN' ? (
                        <button
                          type="button"
                          className="btn-primary !py-1.5 !px-2 !text-xs"
                          disabled={startWaveMut.isPending}
                          onClick={() => startWaveMut.mutate(w.id)}
                        >
                          Start
                        </button>
                      ) : null}
                      {w.status === 'IN_PROGRESS' ? (
                        <button
                          type="button"
                          className="btn-ghost !py-1.5 !px-2 !text-xs"
                          disabled={completeWaveMut.isPending}
                          onClick={() => completeWaveMut.mutate(w.id)}
                        >
                          Complete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {wavePathId && wavePathQ.data?.pickPath?.length ? (
          <div className="pleros-card mt-4">
            <h3 className="text-sm font-semibold text-pleros-white mb-3">
              Bin pick path · wave #{wavePathId.slice(-8)}
            </h3>
            <table className="pleros-table text-sm">
              <thead>
                <tr>
                  <th>Bin</th>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Order</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {wavePathQ.data.pickPath.map((line) => (
                  <tr key={line.lineId}>
                    <td className="font-mono text-pleros-accent">{line.binCode ?? '—'}</td>
                    <td className="font-mono text-xs">…{line.skuId.slice(-6)}</td>
                    <td>{line.quantity}</td>
                    <td className="font-mono text-xs">…{line.orderId.slice(-6)}</td>
                    <td>{line.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <PlerosSheet
        open={waveDrawerOpen}
        onOpenChange={setWaveDrawerOpen}
        title={`New Pick Wave · ${warehouseLabel.get(waveWarehouseId) ?? ''}`}
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
            Select pending pick tasks to include in this wave. Pickers will be guided along a bin-optimized path.
          </p>
          {waveEligibleTasksQ.isLoading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-10 w-full" />
              ))}
            </div>
          ) : (waveEligibleTasksQ.data ?? []).length === 0 ? (
            <p className="text-sm py-4" style={{ color: 'var(--c-text-3)' }}>
              No pending tasks available for this warehouse.
            </p>
          ) : (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {(waveEligibleTasksQ.data ?? []).map((t) => {
                const checked = waveTaskSelection.has(t.id)
                return (
                  <label
                    key={t.id}
                    className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:border-slate-600 transition"
                    style={{
                      borderColor: checked ? 'var(--c-primary)' : 'var(--c-border-card)',
                      background: checked ? 'var(--c-surface-2)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = new Set(waveTaskSelection)
                          if (next.has(t.id)) next.delete(t.id)
                          else next.add(t.id)
                          setWaveTaskSelection(next)
                        }}
                      />
                      <div>
                        <div className="font-mono text-sm font-semibold">#{t.id.slice(-8)}</div>
                        <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                          Order …{t.orderId.slice(-8)} · {t.pickItems?.length ?? 0} lines
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold" style={{ color: priorityBorder(t.priority) }}>
                      {t.priority}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setWaveDrawerOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={waveTaskSelection.size === 0 || createWaveMut.isPending}
              onClick={() => createWaveMut.mutate()}
            >
              {createWaveMut.isPending ? 'Creating…' : `Create wave (${waveTaskSelection.size} tasks)`}
            </button>
          </div>
        </div>
      </PlerosSheet>
    </div>
  )
}
