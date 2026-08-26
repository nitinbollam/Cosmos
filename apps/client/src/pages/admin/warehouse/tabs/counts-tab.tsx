import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { showToast } from '@/lib/toast'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { SpreadsheetImportPanel } from '@/components/pleros/spreadsheet-import-panel'
import { PlerosDialogModal, PlerosSheet } from '@/components/pleros/radix-overlays'
import { rowNumber, rowValue, type BulkImportResult, type SpreadsheetRow } from '@/lib/spreadsheet-import'
import { CycleDetail, CycleRow, WarehouseRow } from '../types'

interface CountsTabProps {
  warehouses: WarehouseRow[]
  warehouseLabel: Map<string, string>
}

export function CountsTab({ warehouses, warehouseLabel }: CountsTabProps) {
  const qc = useQueryClient()
  const [countDrawerOpen, setCountDrawerOpen] = useState(false)
  const [countWh, setCountWh] = useState('')
  const [countType, setCountType] = useState<'FULL' | 'ABC' | 'RANDOM'>('FULL')
  const [countScheduled, setCountScheduled] = useState('')
  const [countDetailId, setCountDetailId] = useState<string | null>(null)
  const [countLineDrafts, setCountLineDrafts] = useState<Record<string, string>>({})

  const countsQ = useQuery({
    queryKey: ['cycle-counts'],
    queryFn: () => api.get<CycleRow[]>('/wms/cycle-counts'),
  })

  const countDetailQ = useQuery({
    queryKey: ['cycle-count', countDetailId],
    queryFn: () => api.get<CycleDetail>(`/wms/cycle-counts/${countDetailId}`),
    enabled: Boolean(countDetailId),
  })

  const createCountMut = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/wms/cycle-counts', {
        warehouseId: countWh,
        type: countType,
        scheduledFor: countScheduled || undefined,
      }),
    onSuccess: (res) => {
      showToast(`Cycle count #${res.id.slice(-8)} created`)
      setCountDrawerOpen(false)
      setCountScheduled('')
      void qc.invalidateQueries({ queryKey: ['cycle-counts'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const patchCountLineMut = useMutation({
    mutationFn: ({ countId, lineId, countedQty }: { countId: string; lineId: string; countedQty: number }) =>
      api.patch(`/wms/cycle-counts/${countId}/lines/${lineId}`, { countedQty }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cycle-count', countDetailId] })
      void qc.invalidateQueries({ queryKey: ['cycle-counts'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const submitCountMut = useMutation({
    mutationFn: (id: string) => api.patch(`/wms/cycle-counts/${id}/submit`),
    onSuccess: () => {
      showToast('Submitted for review')
      void qc.invalidateQueries({ queryKey: ['cycle-counts'] })
      void qc.invalidateQueries({ queryKey: ['cycle-count', countDetailId] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const approveCountMut = useMutation({
    mutationFn: (id: string) => api.patch(`/wms/cycle-counts/${id}/approve`),
    onSuccess: () => {
      showToast('Count approved and variances posted')
      void qc.invalidateQueries({ queryKey: ['cycle-counts'] })
      void qc.invalidateQueries({ queryKey: ['cycle-count', countDetailId] })
      setCountDetailId(null)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const importCountLinesMut = useMutation({
    mutationFn: async ({ countId, rows }: { countId: string; rows: SpreadsheetRow[] }): Promise<BulkImportResult> => {
      let created = 0
      const errors: Array<{ row: number; message: string }> = []
      const detail = countDetailQ.data
      if (!detail) throw new Error('Count not loaded')

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const skuIdOrCode = rowValue(r, 'skuId', 'skuCode', 'sku', 'code')
        const qtyStr = rowValue(r, 'countedQty', 'quantity', 'count', 'counted')
        const qty = parseInt(qtyStr || '0', 10)
        if (!skuIdOrCode) {
          errors.push({ row: i + 1, message: 'Missing SKU' })
          continue
        }
        if (Number.isNaN(qty)) {
          errors.push({ row: i + 1, message: 'Invalid counted quantity' })
          continue
        }
        const line = detail.lines.find(
          (l) => l.skuId === skuIdOrCode || l.skuId.endsWith(skuIdOrCode),
        )
        if (!line) {
          errors.push({ row: i + 1, message: `No count line for SKU ${skuIdOrCode}` })
          continue
        }
        try {
          await api.patch(`/wms/cycle-counts/${countId}/lines/${line.id}`, { countedQty: qty })
          created++
        } catch (e) {
          errors.push({ row: i + 1, message: (e as Error).message })
        }
      }
      return { created, failed: errors.length, errors }
    },
    onSuccess: (res) => {
      showToast(`Imported ${res.created} counts`)
      void qc.invalidateQueries({ queryKey: ['cycle-count', countDetailId] })
      void qc.invalidateQueries({ queryKey: ['cycle-counts'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={() => setCountDrawerOpen(true)}>
          New count
        </button>
      </div>
      <div className="pleros-card overflow-x-auto">
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
            icon="📋"
            title="No cycle counts"
            description="Schedule or generate cycle counts to reconcile physical inventory."
            action={
              <button type="button" className="btn-primary mt-2" onClick={() => setCountDrawerOpen(true)}>
                New count
              </button>
            }
          />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Count</th>
                <th>Warehouse</th>
                <th>Type</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Variances</th>
                <th>Scheduled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(countsQ.data ?? []).map((c) => (
                <tr key={c.id} className="cursor-pointer" onClick={() => setCountDetailId(c.id)}>
                  <td className="font-mono text-sm font-semibold">#{c.id.slice(-8)}</td>
                  <td className="text-sm">{warehouseLabel.get(c.warehouseId) ?? c.warehouseId.slice(-6)}</td>
                  <td>{c.type}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>{c._count?.lines ?? 0}</td>
                  <td>
                    {c.varianceItemsCount != null && c.varianceItemsCount > 0 ? (
                      <span className="text-xs font-semibold" style={{ color: 'var(--c-warning)' }}>
                        {c.varianceItemsCount} items
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                        —
                      </span>
                    )}
                  </td>
                  <td className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                    {c.scheduledFor ? new Date(c.scheduledFor).toLocaleDateString() : '—'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn-ghost !py-1.5 !px-2 !text-xs"
                      onClick={() => setCountDetailId(c.id)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PlerosSheet open={countDrawerOpen} onOpenChange={setCountDrawerOpen} title="New cycle count">
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              Warehouse
            </label>
            <select className="pleros-input" value={countWh} onChange={(e) => setCountWh(e.target.value)}>
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              Type
            </label>
            <select
              className="pleros-input"
              value={countType}
              onChange={(e) => setCountType(e.target.value as 'FULL' | 'ABC' | 'RANDOM')}
            >
              <option value="FULL">FULL</option>
              <option value="ABC">ABC</option>
              <option value="RANDOM">RANDOM</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              Scheduled date (optional)
            </label>
            <input
              type="date"
              className="pleros-input"
              value={countScheduled}
              onChange={(e) => setCountScheduled(e.target.value)}
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            Creates a cycle count for this warehouse. Lines are seeded from current inventory levels when available.
          </p>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setCountDrawerOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!countWh || createCountMut.isPending}
              onClick={() => createCountMut.mutate()}
            >
              {createCountMut.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </PlerosSheet>

      <PlerosDialogModal
        open={!!countDetailId}
        onOpenChange={(o) => {
          if (!o) setCountDetailId(null)
        }}
        title={
          countDetailQ.data
            ? `Cycle count · ${countDetailQ.data.id.slice(-8)}`
            : 'Cycle count'
        }
        maxWidthClass="max-w-4xl"
        footer={
          countDetailQ.data ? (
            <div className="flex flex-wrap gap-2 justify-end">
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
                  Approve &amp; post
                </button>
              )}
            </div>
          ) : undefined
        }
      >
        {countDetailQ.isLoading && countDetailId ? (
          <div className="space-y-2 py-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        ) : countDetailQ.isError ? (
          <p className="text-sm" style={{ color: 'var(--c-danger)' }}>
            {(countDetailQ.error as Error)?.message ?? 'Failed to load count'}
          </p>
        ) : countDetailQ.data ? (
          <>
            <div className="flex justify-between gap-4 mb-4 flex-wrap">
              <div>
                <p className="text-sm font-mono text-pleros-accent break-all">{countDetailQ.data.id}</p>
                <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
                  {warehouseLabel.get(countDetailQ.data.warehouseId)} · {countDetailQ.data.type}
                </p>
              </div>
              <StatusBadge status={countDetailQ.data.status} />
            </div>
            {countDetailQ.data.status === 'IN_PROGRESS' && countDetailQ.data.lines.length > 0 ? (
              <div className="mb-4">
                <SpreadsheetImportPanel
                  title="Import counted quantities"
                  hint="Match rows by SKU id or code and optional location label."
                  expectedColumns={['skuId', 'skuCode', 'locationLabel', 'countedQty']}
                  templateFilename="cycle-count-import-template.csv"
                  onImport={async (rows) =>
                    importCountLinesMut.mutateAsync({ countId: countDetailQ.data!.id, rows })
                  }
                  onDone={() => void countDetailQ.refetch()}
                />
              </div>
            ) : null}
            {countDetailQ.data.lines.length === 0 ? (
              <p className="text-sm py-6" style={{ color: 'var(--c-text-3)' }}>
                No lines yet. Counts seed from inventory stock levels when a cycle count is created, or add lines via API.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                <table className="pleros-table text-sm">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Location</th>
                      <th>System qty</th>
                      <th>Counted qty</th>
                      <th>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countDetailQ.data.lines.map((ln) => {
                      const inProgress = countDetailQ.data!.status === 'IN_PROGRESS'
                      const raw = countLineDrafts[ln.id] ?? ''
                      const countedNum = raw.trim() === '' ? null : parseInt(raw, 10)
                      const varNum =
                        countedNum == null || Number.isNaN(countedNum) ? null : countedNum - ln.systemQty
                      const varDisplay = varNum == null ? '—' : String(varNum)
                      const varNonZero = varNum != null && varNum !== 0
                      return (
                        <tr key={ln.id}>
                          <td className="font-mono text-xs">{ln.skuId}</td>
                          <td>{ln.locationLabel ?? '—'}</td>
                          <td className="font-mono">{ln.systemQty}</td>
                          <td className="min-w-[100px]">
                            {inProgress ? (
                              <input
                                type="number"
                                className="pleros-input !py-1.5 !text-sm w-24"
                                value={countLineDrafts[ln.id] ?? ''}
                                onChange={(e) =>
                                  setCountLineDrafts((prev) => ({ ...prev, [ln.id]: e.target.value }))
                                }
                                onBlur={() => {
                                  if (!countDetailQ.data) return
                                  const v = parseInt(countLineDrafts[ln.id] ?? '', 10)
                                  if (Number.isNaN(v)) return
                                  if (ln.countedQty === v) return
                                  patchCountLineMut.mutate({
                                    countId: countDetailQ.data.id,
                                    lineId: ln.id,
                                    countedQty: v,
                                  })
                                }}
                              />
                            ) : (
                              <span className="font-mono">{ln.countedQty ?? '—'}</span>
                            )}
                          </td>
                          <td
                            className="font-mono"
                            style={{
                              color: varNonZero ? 'var(--c-danger)' : 'var(--c-text-2)',
                            }}
                          >
                            {varDisplay}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </PlerosDialogModal>
    </div>
  )
}
