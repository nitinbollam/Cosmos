import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { showToast } from '@/lib/toast'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { SpreadsheetImportPanel } from '@/components/pleros/spreadsheet-import-panel'
import { PlerosSheet } from '@/components/pleros/radix-overlays'
import { MobileScannerModal } from '@/components/warehouse/mobile-scanner-modal'
import { rowNumber, rowValue, type BulkImportResult, type SpreadsheetRow } from '@/lib/spreadsheet-import'
import { ReceivingDetail, ReceivingRow, WarehouseRow } from '../types'

interface ReceivingTabProps {
  warehouses: WarehouseRow[]
  warehouseLabel: Map<string, string>
}

export function ReceivingTab({ warehouses, warehouseLabel }: ReceivingTabProps) {
  const qc = useQueryClient()
  const [recvDrawer, setRecvDrawer] = useState(false)
  const [recvWh, setRecvWh] = useState('')
  const [recvPo, setRecvPo] = useState('')
  const [recvDetailId, setRecvDetailId] = useState<string | null>(null)
  const [mobileScannerModalOpen, setMobileScannerModalOpen] = useState(false)

  const sessionsQ = useQuery({
    queryKey: ['receiving-sessions'],
    queryFn: () => api.get<ReceivingRow[]>('/wms/receiving/sessions'),
  })

  const recvDetailQ = useQuery({
    queryKey: ['receiving-session', recvDetailId],
    queryFn: () => api.get<ReceivingDetail>(`/wms/receiving/sessions/${recvDetailId}`),
    enabled: Boolean(recvDetailId),
  })

  const startRecvMut = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/wms/receiving/sessions', {
        warehouseId: recvWh,
        purchaseOrderId: recvPo.trim() || undefined,
      }),
    onSuccess: (res) => {
      showToast(`Receiving session #${res.id.slice(-8).toUpperCase()} started`)
      setRecvDrawer(false)
      setRecvPo('')
      void qc.invalidateQueries({ queryKey: ['receiving-sessions'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const completeRecvMut = useMutation({
    mutationFn: (id: string) => api.patch(`/wms/receiving/sessions/${id}/complete`),
    onSuccess: () => {
      showToast('Receiving session completed')
      void qc.invalidateQueries({ queryKey: ['receiving-sessions'] })
      void qc.invalidateQueries({ queryKey: ['receiving-session', recvDetailId] })
      setRecvDetailId(null)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const importReceivingMut = useMutation({
    mutationFn: async ({ sessionId, rows }: { sessionId: string; rows: SpreadsheetRow[] }): Promise<BulkImportResult> => {
      let created = 0
      const errors: Array<{ row: number; message: string }> = []
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const barcode = rowValue(r, 'barcode', 'sku', 'skuId', 'code')
        const qty = parseInt(rowValue(r, 'receivedQty', 'quantity', 'qty') || '1', 10)
        const damaged = parseInt(rowValue(r, 'damagedQty', 'damaged') || '0', 10)
        if (!barcode) {
          errors.push({ row: i + 1, message: 'Missing barcode / SKU' })
          continue
        }
        try {
          await api.post(`/wms/receiving/sessions/${sessionId}/scan`, {
            code: barcode,
            quantity: Number.isNaN(qty) ? 1 : qty,
            damagedQty: Number.isNaN(damaged) ? 0 : damaged,
            batchId: rowValue(r, 'batchId', 'lotNumber') || undefined,
            locationId: rowValue(r, 'locationId', 'binCode') || undefined,
          })
          created++
        } catch (e) {
          errors.push({ row: i + 1, message: (e as Error).message })
        }
      }
      return { created, failed: errors.length, errors }
    },
    onSuccess: (res) => {
      showToast(`Imported ${res.created} receipt items`)
      void qc.invalidateQueries({ queryKey: ['receiving-session', recvDetailId] })
      void qc.invalidateQueries({ queryKey: ['receiving-sessions'] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-pleros-white">Receiving Sessions</h3>
          <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
            Track incoming PO goods, live barcode scans, and receipt batches.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMobileScannerModalOpen(true)}
            className="btn-ghost inline-flex items-center gap-2 text-sm font-semibold !py-2 !px-3.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white shadow-sm transition"
            title="Connect a mobile phone or tablet to scan barcodes"
          >
            <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            <span>Open Mobile Scanner</span>
          </button>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-1.5 !py-2 !px-4 rounded-lg shadow-sm font-semibold text-sm"
            onClick={() => setRecvDrawer(true)}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>New session</span>
          </button>
        </div>
      </div>

      <div className="pleros-card overflow-x-auto">
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
        ) : (sessionsQ.data ?? []).length === 0 ? (
          <EmptyState
            icon="📥"
            title="No receiving sessions"
            description="Start a receiving session to record receipts against POs or blind receipts."
            action={
              <button type="button" className="btn-primary mt-2" onClick={() => setRecvDrawer(true)}>
                New session
              </button>
            }
          />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Warehouse</th>
                <th>PO</th>
                <th>Status</th>
                <th>Items</th>
                <th>Started</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(sessionsQ.data ?? []).map((s) => (
                <tr key={s.id} className="cursor-pointer" onClick={() => setRecvDetailId(s.id)}>
                  <td className="font-mono text-sm font-semibold">#{s.id.slice(-8).toUpperCase()}</td>
                  <td className="text-sm">{warehouseLabel.get(s.warehouseId) ?? s.warehouseId.slice(-6)}</td>
                  <td className="font-mono text-sm" style={{ color: 'var(--c-text-2)' }}>
                    {s.poId ? `PO #${s.poId.slice(-8)}` : '—'}
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td>{s._count?.items ?? 0}</td>
                  <td className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="btn-ghost !py-1.5 !px-2 !text-xs"
                      onClick={() => setRecvDetailId(s.id)}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PlerosSheet
        open={recvDrawer}
        onOpenChange={setRecvDrawer}
        title="New receiving session"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1" style={{ color: 'var(--c-text-2)' }}>
              Warehouse
            </label>
            <select className="pleros-input" value={recvWh} onChange={(e) => setRecvWh(e.target.value)}>
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
              Purchase Order ID (optional)
            </label>
            <input
              className="pleros-input"
              value={recvPo}
              onChange={(e) => setRecvPo(e.target.value)}
              placeholder="e.g. PO-1001"
            />
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setRecvDrawer(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!recvWh || startRecvMut.isPending}
              onClick={() => startRecvMut.mutate()}
            >
              {startRecvMut.isPending ? 'Starting…' : 'Start session'}
            </button>
          </div>
        </div>
      </PlerosSheet>

      <PlerosSheet
        open={Boolean(recvDetailId)}
        onOpenChange={(open) => !open && setRecvDetailId(null)}
        title={
          recvDetailQ.data
            ? `Receiving Session #${recvDetailQ.data.id.slice(-8).toUpperCase()}`
            : 'Receiving Session'
        }
      >
        {recvDetailQ.isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        ) : recvDetailQ.data ? (
          <div className="space-y-4 text-sm">
            <div className="flex justify-between items-center">
              <StatusBadge status={recvDetailQ.data.status} />
              <span className="font-mono text-xs" style={{ color: 'var(--c-text-3)' }}>
                {warehouseLabel.get(recvDetailQ.data.warehouseId)}
              </span>
            </div>

            {recvDetailQ.data.poId && (
              <p className="font-mono text-xs text-sky-400">PO #{recvDetailQ.data.poId.slice(-8)}</p>
            )}

            {(recvDetailQ.data.status === 'OPEN' || recvDetailQ.data.status === 'IN_PROGRESS') && (
              <div className="mb-4">
                <SpreadsheetImportPanel
                  title="Import received lines"
                  hint="Upload counted receipts instead of scanning one line at a time."
                  expectedColumns={['barcode', 'receivedQty', 'damagedQty', 'batchId', 'locationId']}
                  templateFilename="receiving-import-template.csv"
                  onImport={async (rows) =>
                    importReceivingMut.mutateAsync({ sessionId: recvDetailQ.data!.id, rows })
                  }
                />
              </div>
            )}

            <table className="pleros-table">
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

            <div className="pt-4 flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => setRecvDetailId(null)}>
                Close
              </button>
              {(recvDetailQ.data.status === 'OPEN' || recvDetailQ.data.status === 'IN_PROGRESS') && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={completeRecvMut.isPending || (recvDetailQ.data.items?.length ?? 0) < 1}
                  onClick={() => completeRecvMut.mutate(recvDetailQ.data!.id)}
                >
                  {completeRecvMut.isPending ? 'Completing…' : 'Complete session'}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </PlerosSheet>

      <MobileScannerModal
        open={mobileScannerModalOpen}
        onClose={() => setMobileScannerModalOpen(false)}
      />
    </div>
  )
}
