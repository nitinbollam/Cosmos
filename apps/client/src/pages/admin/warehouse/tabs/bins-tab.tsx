import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { showToast } from '@/lib/toast'
import { EmptyState } from '@/components/pleros/empty-state'
import { SpreadsheetImportPanel } from '@/components/pleros/spreadsheet-import-panel'
import { rowValue, rowNumber, type BulkImportResult, type SpreadsheetRow } from '@/lib/spreadsheet-import'
import { BinRow, WarehouseRow } from '../types'

interface BinsTabProps {
  warehouses: WarehouseRow[]
}

export function BinsTab({ warehouses }: BinsTabProps) {
  const qc = useQueryClient()
  const [binWarehouseId, setBinWarehouseId] = useState<string>('')
  const [binCode, setBinCode] = useState('')
  const [binAisle, setBinAisle] = useState('')
  const [binZone, setBinZone] = useState('')

  const binsQ = useQuery({
    queryKey: ['bins', binWarehouseId],
    queryFn: () => api.get<BinRow[]>(`/bins?warehouseId=${encodeURIComponent(binWarehouseId)}`),
    enabled: Boolean(binWarehouseId),
  })

  const createBinMut = useMutation({
    mutationFn: () =>
      api.post('/bins', {
        warehouseId: binWarehouseId,
        code: binCode.trim(),
        aisle: binAisle.trim() || undefined,
        zone: binZone.trim() || undefined,
      }),
    onSuccess: () => {
      showToast('Bin created')
      setBinCode('')
      setBinAisle('')
      setBinZone('')
      void qc.invalidateQueries({ queryKey: ['bins', binWarehouseId] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const deleteBinMut = useMutation({
    mutationFn: (id: string) => api.delete(`/bins/${id}`),
    onSuccess: () => {
      showToast('Bin removed')
      void qc.invalidateQueries({ queryKey: ['bins', binWarehouseId] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const importBinsMut = useMutation({
    mutationFn: async (rows: SpreadsheetRow[]): Promise<BulkImportResult> => {
      let created = 0
      const errors: Array<{ row: number; message: string }> = []
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const code = rowValue(r, 'code', 'binCode')
        if (!code) {
          errors.push({ row: i + 1, message: 'Missing bin code' })
          continue
        }
        try {
          await api.post('/bins', {
            warehouseId: binWarehouseId,
            code,
            aisle: rowValue(r, 'aisle') || undefined,
            zone: rowValue(r, 'zone') || undefined,
          })
          created++
        } catch (e) {
          errors.push({ row: i + 1, message: (e as Error).message })
        }
      }
      return { created, failed: errors.length, errors }
    },
    onSuccess: (res) => {
      showToast(`Imported ${res.created} bins`)
      void qc.invalidateQueries({ queryKey: ['bins', binWarehouseId] })
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>
            Warehouse
          </div>
          <select
            className="pleros-input w-auto min-w-[200px]"
            value={binWarehouseId}
            onChange={(e) => setBinWarehouseId(e.target.value)}
          >
            <option value="">Select warehouse…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!binWarehouseId ? (
        <EmptyState icon="📦" title="Select a warehouse" description="Bin locations are scoped to a single warehouse." />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="pleros-card">
              <h3 className="text-sm font-semibold text-pleros-white mb-3">Add bin location</h3>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--c-text-3)' }}>
                    Code
                  </label>
                  <input
                    className="pleros-input w-32"
                    value={binCode}
                    onChange={(e) => setBinCode(e.target.value)}
                    placeholder="A-01-01"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--c-text-3)' }}>
                    Aisle
                  </label>
                  <input className="pleros-input w-24" value={binAisle} onChange={(e) => setBinAisle(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--c-text-3)' }}>
                    Zone
                  </label>
                  <input
                    className="pleros-input w-24"
                    value={binZone}
                    onChange={(e) => setBinZone(e.target.value)}
                    placeholder="PICK"
                  />
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!binCode.trim() || createBinMut.isPending}
                  onClick={() => createBinMut.mutate()}
                >
                  Add bin
                </button>
              </div>
            </div>

            <div className="pleros-card">
              <SpreadsheetImportPanel
                title="Bulk import bins"
                hint="Upload CSV or Excel with code, aisle, and zone columns."
                expectedColumns={['code', 'aisle', 'zone']}
                templateFilename="bins-import-template.csv"
                onImport={(rows) => importBinsMut.mutateAsync(rows)}
              />
            </div>
          </div>

          <div className="pleros-card overflow-x-auto">
            {binsQ.isLoading ? (
              <div className="space-y-2 py-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-10 w-full" />
                ))}
              </div>
            ) : binsQ.isError ? (
              <p className="text-sm py-8" style={{ color: 'var(--c-danger)' }}>
                {(binsQ.error as Error)?.message ?? 'Failed to load bins'}
              </p>
            ) : (binsQ.data ?? []).length === 0 ? (
              <EmptyState icon="📍" title="No bin locations" description="Create aisle/shelf codes for directed putaway and picking." />
            ) : (
              <table className="pleros-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Aisle</th>
                    <th>Zone</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(binsQ.data ?? []).map((b) => (
                    <tr key={b.id}>
                      <td className="font-mono font-semibold">{b.code}</td>
                      <td>{b.aisle ?? '—'}</td>
                      <td>{b.zone ?? '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-ghost !py-1 !px-2 !text-xs"
                          style={{ color: 'var(--c-danger)' }}
                          disabled={deleteBinMut.isPending}
                          onClick={() => {
                            if (window.confirm(`Remove bin ${b.code}?`)) deleteBinMut.mutate(b.id)
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
