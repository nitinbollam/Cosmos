import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { buildCsv, downloadCsvText } from '@/lib/csv-download'
import { EmptyState } from '@/components/pleros/empty-state'

type ReportType = 'ORDERS' | 'INVENTORY' | 'AR_AGING'

type CatalogItem = {
  type: ReportType
  label: string
  description: string
  columns: Array<{ key: string; label: string }>
  filters: string[]
}

type ReportFilters = {
  status?: string
  channel?: string
  search?: string
  fromIso?: string
  toIso?: string
  customerId?: string
  category?: string
  warehouseId?: string
  inStockOnly?: boolean
  lowStockOnly?: boolean
  openOnly?: boolean
}

type RunResult = {
  type: ReportType
  columns: Array<{ key: string; label: string }>
  rows: Array<Record<string, string | number | boolean | null>>
  summary?: Record<string, number>
  truncated: boolean
}

type SavedReport = {
  id: string
  name: string
  type: ReportType
  filters: ReportFilters
  createdAt: string
  updatedAt: string
}

type WarehouseRow = { id: string; name: string; code: string }

const ORDER_STATUSES = ['ALL', 'PENDING', 'CONFIRMED', 'FULFILLED', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED']
const CHANNELS = ['ALL', 'B2B_PORTAL', 'POS', 'SALES_REP', 'API']

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
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

export default function ReportsPage() {
  const qc = useQueryClient()
  const [type, setType] = useState<ReportType>('ORDERS')
  const [filters, setFilters] = useState<ReportFilters>({ openOnly: true })
  const [saveName, setSaveName] = useState('')
  const [preview, setPreview] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const catalogQ = useQuery({
    queryKey: ['report-builder', 'types'],
    queryFn: () => api.get<CatalogItem[]>('/report-builder/types'),
  })

  const savedQ = useQuery({
    queryKey: ['report-builder', 'saved'],
    queryFn: () => api.get<SavedReport[]>('/report-builder/saved'),
  })

  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseRow[]>('/warehouses'),
    enabled: type === 'INVENTORY',
  })

  const activeCatalog = useMemo(
    () => catalogQ.data?.find((c) => c.type === type) ?? null,
    [catalogQ.data, type],
  )

  const runMut = useMutation({
    mutationFn: async (format: 'json' | 'csv') => {
      const result = await api.post<RunResult>('/report-builder/run', { type, filters })
      return { format, result }
    },
    onSuccess: ({ format, result }) => {
      setError(null)
      setPreview(result)
      if (format === 'csv') {
        const headers = result.columns.map((c) => c.label)
        const rows = result.rows.map((row) => result.columns.map((c) => row[c.key]))
        downloadCsvText(
          `${type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`,
          buildCsv(headers, rows),
        )
      }
    },
    onError: (e) => setError(errMsg(e)),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const name = saveName.trim() || `${activeCatalog?.label ?? type} — ${new Date().toLocaleDateString()}`
      return api.post<SavedReport>('/report-builder/saved', { name, type, filters })
    },
    onSuccess: () => {
      setSaveName('')
      setError(null)
      void qc.invalidateQueries({ queryKey: ['report-builder', 'saved'] })
    },
    onError: (e) => setError(errMsg(e)),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/report-builder/saved/${encodeURIComponent(id)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['report-builder', 'saved'] }),
    onError: (e) => setError(errMsg(e)),
  })

  const runSavedMut = useMutation({
    mutationFn: async ({ id, format }: { id: string; format: 'json' | 'csv' }) => {
      const result = await api.post<RunResult>(`/report-builder/saved/${encodeURIComponent(id)}/run`, {})
      return { id, format, result }
    },
    onSuccess: ({ id, format, result }) => {
      setError(null)
      const saved = savedQ.data?.find((s) => s.id === id)
      if (saved) {
        setType(saved.type)
        setFilters(saved.filters ?? { openOnly: true })
      }
      setPreview(result)
      if (format === 'csv') {
        const base = (saved?.name || 'report').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48)
        const headers = result.columns.map((c) => c.label)
        const rows = result.rows.map((row) => result.columns.map((c) => row[c.key]))
        downloadCsvText(`${base}-${new Date().toISOString().slice(0, 10)}.csv`, buildCsv(headers, rows))
      }
    },
    onError: (e) => setError(errMsg(e)),
  })

  function patchFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function loadSaved(s: SavedReport) {
    setType(s.type)
    setFilters(s.filters ?? { openOnly: true })
    setSaveName(s.name)
    setPreview(null)
    setError(null)
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white font-display">Reports</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
          Build, save, and export orders, inventory, and AR aging as CSV.
        </p>
      </div>

      {error && (
        <div className="pleros-card text-sm" style={{ borderColor: 'var(--c-danger)', color: 'var(--c-danger)' }}>
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="pleros-card space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--c-text-3)' }}>
                Report type
              </div>
              <div className="flex flex-wrap gap-2">
                {(catalogQ.data ?? [
                  { type: 'ORDERS' as const, label: 'Orders', description: '' },
                  { type: 'INVENTORY' as const, label: 'Inventory', description: '' },
                  { type: 'AR_AGING' as const, label: 'AR aging', description: '' },
                ]).map((c) => (
                  <button
                    key={c.type}
                    type="button"
                    className={type === c.type ? 'btn-primary !text-sm' : 'btn-ghost !text-sm'}
                    onClick={() => {
                      setType(c.type)
                      setPreview(null)
                      setFilters(c.type === 'AR_AGING' ? { openOnly: true } : {})
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {activeCatalog && (
                <p className="text-sm mt-2" style={{ color: 'var(--c-text-3)' }}>
                  {activeCatalog.description}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {type === 'ORDERS' && (
                <>
                  <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                    Status
                    <select
                      className="pleros-input"
                      value={filters.status ?? 'ALL'}
                      onChange={(e) => patchFilter('status', e.target.value === 'ALL' ? undefined : e.target.value)}
                    >
                      {ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                    Channel
                    <select
                      className="pleros-input"
                      value={filters.channel ?? 'ALL'}
                      onChange={(e) => patchFilter('channel', e.target.value === 'ALL' ? undefined : e.target.value)}
                    >
                      {CHANNELS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                    From
                    <input
                      type="date"
                      className="pleros-input"
                      value={filters.fromIso ?? ''}
                      onChange={(e) => patchFilter('fromIso', e.target.value || undefined)}
                    />
                  </label>
                  <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                    To
                    <input
                      type="date"
                      className="pleros-input"
                      value={filters.toIso ?? ''}
                      onChange={(e) => patchFilter('toIso', e.target.value || undefined)}
                    />
                  </label>
                  <label className="text-xs space-y-1 sm:col-span-2" style={{ color: 'var(--c-text-3)' }}>
                    Search
                    <input
                      className="pleros-input"
                      placeholder="Order or customer id…"
                      value={filters.search ?? ''}
                      onChange={(e) => patchFilter('search', e.target.value || undefined)}
                    />
                  </label>
                </>
              )}

              {type === 'INVENTORY' && (
                <>
                  <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                    Search
                    <input
                      className="pleros-input"
                      placeholder="SKU code or name…"
                      value={filters.search ?? ''}
                      onChange={(e) => patchFilter('search', e.target.value || undefined)}
                    />
                  </label>
                  <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                    Category
                    <input
                      className="pleros-input"
                      placeholder="Optional"
                      value={filters.category ?? ''}
                      onChange={(e) => patchFilter('category', e.target.value || undefined)}
                    />
                  </label>
                  <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                    Warehouse
                    <select
                      className="pleros-input"
                      value={filters.warehouseId ?? ''}
                      onChange={(e) => patchFilter('warehouseId', e.target.value || undefined)}
                    >
                      <option value="">All warehouses</option>
                      {(warehousesQ.data ?? []).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} · {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-col justify-end gap-2 pb-1">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!filters.inStockOnly}
                        onChange={(e) => patchFilter('inStockOnly', e.target.checked || undefined)}
                      />
                      In stock only
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!filters.lowStockOnly}
                        onChange={(e) => patchFilter('lowStockOnly', e.target.checked || undefined)}
                      />
                      Low stock only
                    </label>
                  </div>
                </>
              )}

              {type === 'AR_AGING' && (
                <>
                  <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                    Customer ID
                    <input
                      className="pleros-input font-mono"
                      placeholder="Optional"
                      value={filters.customerId ?? ''}
                      onChange={(e) => patchFilter('customerId', e.target.value || undefined)}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer self-end pb-2">
                    <input
                      type="checkbox"
                      checked={filters.openOnly !== false}
                      onChange={(e) => patchFilter('openOnly', e.target.checked)}
                    />
                    Open balances only
                  </label>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-2 pt-2" style={{ borderTop: '1px solid var(--c-border)' }}>
              <label className="text-xs space-y-1 flex-1 min-w-[12rem]" style={{ color: 'var(--c-text-3)' }}>
                Save as
                <input
                  className="pleros-input"
                  placeholder="Report name…"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn-ghost !text-sm"
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate()}
              >
                Save report
              </button>
              <button
                type="button"
                className="btn-ghost !text-sm"
                disabled={runMut.isPending}
                onClick={() => runMut.mutate('json')}
              >
                Preview
              </button>
              <button
                type="button"
                className="btn-primary !text-sm"
                disabled={runMut.isPending}
                onClick={() => runMut.mutate('csv')}
              >
                Export CSV
              </button>
            </div>
          </div>

          {preview && (
            <div className="pleros-card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-pleros-white font-semibold font-display">
                  Preview · {preview.rows.length.toLocaleString()} rows
                  {preview.truncated ? ' (truncated)' : ''}
                </h3>
              </div>
              {preview.summary && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                  {Object.entries(preview.summary).map(([k, v]) => (
                    <div key={k} className="rounded-lg px-3 py-2" style={{ background: 'var(--c-surface-2)' }}>
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                        {k}
                      </div>
                      <div className="font-mono text-sm mt-1" style={{ color: 'var(--c-heading)' }}>
                        {k === 'totalOpen' || k.includes('-') || k.includes('+') ? money(v) : v}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {preview.rows.length === 0 ? (
                <EmptyState icon="∅" title="No rows" description="Adjust filters and run again." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="pleros-table">
                    <thead>
                      <tr>
                        {preview.columns.map((c) => (
                          <th key={c.key}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 100).map((row, i) => (
                        <tr key={i}>
                          {preview.columns.map((c) => (
                            <td key={c.key} className="font-mono text-xs whitespace-nowrap">
                              {row[c.key] == null ? '—' : String(row[c.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.rows.length > 100 && (
                    <p className="text-xs mt-2" style={{ color: 'var(--c-text-3)' }}>
                      Showing first 100 of {preview.rows.length.toLocaleString()}. Export CSV for the full set.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="pleros-card space-y-3 h-fit">
          <h3 className="text-pleros-white font-semibold font-display">Saved reports</h3>
          {savedQ.isLoading ? (
            <div className="skeleton h-24 w-full" />
          ) : (savedQ.data ?? []).length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
              No saved reports yet. Configure filters and click Save report.
            </p>
          ) : (
            <ul className="space-y-3">
              {(savedQ.data ?? []).map((s) => (
                <li key={s.id} className="rounded-lg p-3 space-y-2" style={{ background: 'var(--c-surface-2)' }}>
                  <button type="button" className="text-left w-full" onClick={() => loadSaved(s)}>
                    <div className="font-medium text-sm" style={{ color: 'var(--c-heading)' }}>
                      {s.name}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
                      {s.type.replace('_', ' ')} · {new Date(s.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="btn-ghost !text-xs !py-1 !px-2"
                      disabled={runSavedMut.isPending}
                      onClick={() => runSavedMut.mutate({ id: s.id, format: 'json' })}
                    >
                      Run
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !text-xs !py-1 !px-2"
                      disabled={runSavedMut.isPending}
                      onClick={() => runSavedMut.mutate({ id: s.id, format: 'csv' })}
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !text-xs !py-1 !px-2"
                      disabled={deleteMut.isPending}
                      onClick={() => {
                        if (confirm(`Delete “${s.name}”?`)) deleteMut.mutate(s.id)
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
