import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, formatApiReachabilityError } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { EmptyState } from '@/components/pleros/empty-state'
import { SpreadsheetImportPanel } from '@/components/pleros/spreadsheet-import-panel'
import { PlerosDialogModal, PlerosSheet } from '@/components/pleros/radix-overlays'
import { rowNumber, rowValue, type BulkImportResult } from '@/lib/spreadsheet-import'
import { ScanButton } from '@/components/scanner'

type SkuRow = {
  id: string
  code: string
  name: string
  category: string
  price: string | number
  cost?: string | number
  quantityOnHand?: number
  quantityReserved?: number
  quantityAvailable?: number
  reorderPoint?: number
  isActive?: boolean
}

type SkuPage = {
  items: SkuRow[]
  total: number
  page: number
  pageSize: number
  hasMore?: boolean
}

type WarehouseRow = { id: string; name: string; code: string }

type StockLevelRow = {
  id: string
  warehouseId: string
  locationId?: string | null
  batchId?: string | null
  reorderPoint?: number
  reorderQty?: number
}

type LedgerRow = {
  id: string
  warehouseId: string
  locationId?: string | null
  batchId?: string | null
  eventType: string
  quantityDelta: number
  quantityAfter: number
  unitCost: string | number
  referenceId?: string | null
  referenceType?: string | null
  performedBy: string
  occurredAt: string
}

const UOM_OPTIONS = ['EACH', 'CASE', 'PALLET']

type SavePayload = {
  sku: Record<string, unknown>
  editStock?: {
    mode: 'patch' | 'ensure'
    levelId?: string
    warehouseId?: string
    locationId: string
    reorderPoint: number
    reorderQty: number
    skuId: string
  }
}

function isNonBatchBatchId(batchId: string | null | undefined) {
  return batchId == null || batchId === ''
}

type DemandPlanRow = {
  sku: { code: string; name: string }
  warehouseId: string
  avgDailyUsage: number
  ewmaDailyUsage?: number
  suggestedOrderQty: number
  quantityAvailable: number
  method: string
  warnings?: string[]
}

export default function InventoryPage() {
  const qc = useQueryClient()
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [category, setCategory] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 50

  const [drawer, setDrawer] = useState<'new' | 'edit' | null>(null)
  const [editId, setEditId] = useState<string | null>(null)

  const [historySkuId, setHistorySkuId] = useState<string | null>(null)
  const [adjustOpen, setAdjustOpen] = useState<SkuRow | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const [adjWarehouse, setAdjWarehouse] = useState('')
  const [adjDelta, setAdjDelta] = useState(0)
  const [adjReason, setAdjReason] = useState('')

  // Code of the SKU resolved by the last scan, so we can show its stock summary.
  const [scannedCode, setScannedCode] = useState<string | null>(null)
  const [scanErr, setScanErr] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  /**
   * Resolve a scanned barcode to a SKU and filter the list to it.
   *
   * We search by the resolved SKU *code* rather than the raw barcode, because
   * the list endpoint matches code and name — not barcode. The lookup endpoint
   * does the barcode work (and handles GTIN-8/12/13/14 variants), so a label
   * that reads 12 digits on one device and 13 on another still lands here.
   */
  const resolveScan = useCallback(
    async (rawValue: string) => {
      const value = rawValue.trim()
      if (!value) return
      setScanErr(null)
      setScannedCode(null)
      try {
        const sku = await api.get<SkuRow>(`/skus/lookup/scan-value?value=${encodeURIComponent(value)}`)
        setSearchInput(sku.code)
        setScannedCode(sku.code)
      } catch {
        // 404 is the expected miss here: a real barcode with no SKU behind it.
        setScanErr(`No SKU found for ${value}`)
      }
    },
    [],
  )

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, category, warehouseId, inStockOnly])

  const categoriesQ = useQuery({
    queryKey: ['skus', 'categories'],
    queryFn: () => api.get<string[]>('/skus/categories'),
  })

  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseRow[]>('/warehouses'),
  })

  const demandQ = useQuery({
    queryKey: ['inventory', 'demand-plan', warehouseId],
    queryFn: () => {
      const q = new URLSearchParams({ days: '30', limit: '15' })
      if (warehouseId) q.set('warehouseId', warehouseId)
      return api.get<DemandPlanRow[]>(`/inventory/demand-plan?${q.toString()}`)
    },
  })

  const whMap = new Map((warehousesQ.data ?? []).map((w) => [w.id, `${w.code} · ${w.name}`]))

  const skusQ = useQuery({
    queryKey: ['skus', debouncedSearch, category, warehouseId, inStockOnly, page],
    queryFn: async () => {
      const q = new URLSearchParams()
      q.set('page', String(page))
      q.set('pageSize', String(pageSize))
      if (debouncedSearch) q.set('search', debouncedSearch)
      if (category) q.set('category', category)
      if (warehouseId) q.set('warehouseId', warehouseId)
      if (inStockOnly) q.set('inStock', 'true')
      return api.get<SkuPage>(`/skus?${q.toString()}`)
    },
  })

  const editSkuQ = useQuery({
    queryKey: ['skus', editId],
    enabled: !!editId && drawer === 'edit',
    queryFn: () => api.get<Record<string, unknown>>(`/skus/${editId}`),
  })

  const editLevelsQ = useQuery({
    queryKey: ['inventory', 'levels', editId, 'drawer'],
    enabled: !!editId && drawer === 'edit',
    queryFn: () => api.get<StockLevelRow[]>(`/inventory/levels?skuId=${encodeURIComponent(editId!)}`),
  })

  const ledgerQ = useQuery({
    queryKey: ['inventory', 'ledger', historySkuId],
    enabled: !!historySkuId,
    queryFn: () => api.get<LedgerRow[]>(`/inventory/ledger?skuId=${encodeURIComponent(historySkuId!)}&limit=80`),
  })

  const saveMut = useMutation({
    mutationFn: async (payload: SavePayload) => {
      const { sku, editStock } = payload
      if (drawer === 'edit' && editId) {
        await api.patch(`/skus/${encodeURIComponent(editId)}`, sku)
        if (editStock) {
          if (editStock.mode === 'patch' && editStock.levelId) {
            await api.patch(`/inventory/levels/${encodeURIComponent(editStock.levelId)}`, {
              reorderPoint: editStock.reorderPoint,
              reorderQty: editStock.reorderQty,
              locationId: editStock.locationId.trim() || null,
            })
          } else if (editStock.mode === 'ensure' && editStock.warehouseId) {
            await api.post('/inventory/levels/ensure', {
              skuId: editStock.skuId,
              warehouseId: editStock.warehouseId,
              locationId: editStock.locationId.trim() || undefined,
              reorderPoint: editStock.reorderPoint,
              reorderQty: editStock.reorderQty,
            })
          }
        }
      } else {
        await api.post('/skus', sku)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skus'] })
      void qc.invalidateQueries({ queryKey: ['inventory', 'levels'] })
      setDrawer(null)
      setEditId(null)
    },
  })

  const adjustMut = useMutation({
    mutationFn: async () => {
      if (!adjustOpen || !adjWarehouse) throw new Error('warehouse required')
      const reason = adjReason.trim()
      if (!reason) throw new Error('reason required')
      await api.post('/inventory/adjust', {
        skuId: adjustOpen.id,
        warehouseId: adjWarehouse,
        quantityDelta: adjDelta,
        reason,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skus'] })
      void qc.invalidateQueries({ queryKey: ['inventory'] })
      setAdjustOpen(null)
      setAdjDelta(0)
      setAdjReason('')
      setAdjWarehouse('')
    },
  })

  const totalPages = Math.max(1, Math.ceil((skusQ.data?.total ?? 0) / pageSize))

  // The scanned SKU's row, once the filtered list lands. listSkus already
  // enriches rows with stock figures, so answering "how many do I have?" needs
  // no extra request — we just read the row the scan filtered us down to.
  const scannedRow = scannedCode
    ? (skusQ.data?.items ?? []).find((s) => s.code === scannedCode)
    : undefined

  const drawerOpen = drawer === 'new' || drawer === 'edit'

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white" style={{ fontFamily: 'var(--font-display)' }}>
            Inventory
          </h1>
          <p className="text-pleros-text-3 text-sm mt-1">SKUs, stock positions, and adjustments</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => setImportOpen((open) => !open)}>
            {importOpen ? 'Hide import' : 'Import CSV/Excel'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setEditId(null)
              setDrawer('new')
            }}
          >
            New SKU
          </button>
        </div>
      </div>

      {(demandQ.data ?? []).length > 0 ? (
        <div className="pleros-card">
          <h3 className="text-pleros-white font-semibold font-display mb-2">Demand-based replenishment</h3>
          <p className="text-sm text-pleros-text-3 mb-3">
            Suggested buy quantities from EWMA usage forecast and lead time (≈70-day lookback).
          </p>
          <div className="overflow-x-auto">
            <table className="pleros-table text-sm">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Available</th>
                  <th>EWMA/day</th>
                  <th>Avg/day</th>
                  <th>Suggest buy</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {(demandQ.data ?? []).map((row) => (
                  <tr key={`${row.sku.code}-${row.warehouseId}`}>
                    <td>
                      <span className="font-mono text-pleros-accent">{row.sku.code}</span>
                      <span className="text-pleros-text-3 ml-2">{row.sku.name}</span>
                      {row.warnings?.[0] ? (
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--c-warning)' }}>
                          {row.warnings[0]}
                        </p>
                      ) : null}
                    </td>
                    <td>{row.quantityAvailable}</td>
                    <td className="tabular-nums">{row.ewmaDailyUsage ?? row.avgDailyUsage}</td>
                    <td className="tabular-nums text-pleros-text-3">{row.avgDailyUsage}</td>
                    <td className="font-semibold text-pleros-white">{row.suggestedOrderQty}</td>
                    <td>
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--c-surface-2)', color: 'var(--c-accent)' }}
                      >
                        {row.method.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {importOpen ? (
        <SpreadsheetImportPanel
          title="Import SKUs"
          expectedColumns={['code', 'name', 'category', 'cost', 'price', 'barcode', 'unitOfMeasure', 'reorderPoint', 'reorderQty']}
          templateFilename="skus-import-template.csv"
          onImport={async (rows) => {
            const payload = rows
              .map((row) => {
                const code = rowValue(row, 'code', 'skuCode', 'sku_code')
                const name = rowValue(row, 'name', 'description')
                const category = rowValue(row, 'category')
                const cost = rowNumber(row, 'cost')
                const price = rowNumber(row, 'price')
                if (!code || !name || !category || cost == null || price == null) return null
                const reorderPoint = rowNumber(row, 'reorderPoint', 'reorder_point')
                const reorderQty = rowNumber(row, 'reorderQty', 'reorder_qty')
                return {
                  code,
                  name,
                  category,
                  cost,
                  price,
                  barcode: rowValue(row, 'barcode', 'upc') || undefined,
                  unitOfMeasure: rowValue(row, 'unitOfMeasure', 'unit_of_measure', 'uom') || undefined,
                  reorderPoint,
                  reorderQty,
                }
              })
              .filter((row): row is NonNullable<typeof row> => row != null)
            const result = await api.post<BulkImportResult>('/skus/import', { rows: payload })
            void qc.invalidateQueries({ queryKey: ['skus'] })
            void qc.invalidateQueries({ queryKey: ['skus', 'categories'] })
            return result
          }}
        />
      ) : null}

      <div className="pleros-card flex flex-wrap gap-4 items-end">
        <div className="min-w-[200px] flex-1">
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-pleros-text-3">Search</label>
          <div className="flex items-center gap-2">
            <input
              className="pleros-input flex-1"
              placeholder="Code or name"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <ScanButton onScan={(r) => void resolveScan(r.rawValue)} title="Scan to check stock" />
          </div>
          {scanErr && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--c-danger)' }}>
              {scanErr}
            </p>
          )}
        </div>
        {scannedRow && (
          <div className="scan-stock-card">
            <div className="scan-stock-id">
              <span className="scan-stock-code">{scannedRow.code}</span>
              <span className="scan-stock-name">{scannedRow.name}</span>
            </div>
            <div className="scan-stock-figures">
              <div>
                <span className="scan-stock-label">On hand</span>
                <span className="scan-stock-value">{scannedRow.quantityOnHand ?? 0}</span>
              </div>
              <div>
                <span className="scan-stock-label">Reserved</span>
                <span className="scan-stock-value">{scannedRow.quantityReserved ?? 0}</span>
              </div>
              <div>
                <span className="scan-stock-label">Available</span>
                <span className="scan-stock-value strong">{scannedRow.quantityAvailable ?? 0}</span>
              </div>
            </div>
            <button
              type="button"
              className="scan-stock-clear"
              onClick={() => {
                setScannedCode(null)
                setSearchInput('')
              }}
            >
              Clear
            </button>
          </div>
        )}
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-pleros-text-3">Category</label>
          <select className="pleros-input w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {(categoriesQ.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-pleros-text-3">Warehouse</label>
          <select className="pleros-input w-[220px]" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">All (totals)</option>
            {(warehousesQ.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer pb-2">
          <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
          <span className="text-sm text-pleros-text">In stock only</span>
        </label>
      </div>

      <div className="pleros-card overflow-x-auto">
        {skusQ.isLoading ? (
          <div className="py-8 space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        ) : skusQ.isError ? (
          <p className="text-sm py-8 max-w-xl" style={{ color: 'var(--c-danger)' }}>
            {formatApiReachabilityError(skusQ.error)}
          </p>
        ) : (skusQ.data?.items ?? []).length === 0 ? (
          <EmptyState
            icon="📦"
            title="No SKUs match"
            description="Try clearing filters or create a new SKU."
            action={
              <button type="button" className="btn-primary mt-4" onClick={() => setDrawer('new')}>
                New SKU
              </button>
            }
          />
        ) : (
          <>
            <table className="pleros-table">
              <thead>
                <tr>
                  <th>SKU code</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>On hand</th>
                  <th>Reserved</th>
                  <th>Available</th>
                  <th>Reorder</th>
                  <th>Cost</th>
                  <th>Price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(skusQ.data?.items ?? []).map((s) => (
                  <tr key={s.id} className={s.isActive === false ? 'opacity-50' : ''}>
                    <td className="font-mono text-xs">
                      <Link to={adminPath(`/inventory/${encodeURIComponent(s.id)}`)} className="text-pleros-accent hover:underline">
                        {s.code}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate">{s.name}</td>
                    <td className="text-pleros-text-2 text-sm">{s.category}</td>
                    <td>{s.quantityOnHand ?? 0}</td>
                    <td>{s.quantityReserved ?? 0}</td>
                    <td>{s.quantityAvailable ?? 0}</td>
                    <td className="font-mono text-sm">{s.reorderPoint ?? 0}</td>
                    <td className="font-mono text-sm">${Number(s.cost ?? 0).toFixed(2)}</td>
                    <td className="font-mono text-sm">${Number(s.price).toFixed(2)}</td>
                    <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn-ghost !py-1 !px-2 !text-xs mr-1"
                        onClick={() => {
                          setEditId(s.id)
                          setDrawer('edit')
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !py-1 !px-2 !text-xs mr-1"
                        onClick={() => setHistorySkuId(s.id)}
                      >
                        History
                      </button>
                      <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => setAdjustOpen(s)}>
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between mt-4 pt-4 border-t" style={{ borderColor: 'var(--c-border)' }}>
              <p className="text-sm text-pleros-text-3">
                Page {page} of {totalPages} · {(skusQ.data?.total ?? 0).toLocaleString()} SKUs
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-ghost !py-2 !px-3 !text-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-ghost !py-2 !px-3 !text-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <PlerosSheet
        open={drawerOpen}
        onOpenChange={(o) => {
          if (!o) {
            setDrawer(null)
            setEditId(null)
          }
        }}
        title={drawer === 'edit' ? 'Edit SKU' : 'New SKU'}
      >
        <SkuDrawer
          mode={drawer ?? 'new'}
          editId={editId}
          initial={drawer === 'edit' ? editSkuQ.data : undefined}
          stockLevels={drawer === 'edit' ? editLevelsQ.data : undefined}
          loading={drawer === 'edit' && (editSkuQ.isLoading || editLevelsQ.isLoading)}
          warehouses={warehousesQ.data ?? []}
          saving={saveMut.isPending}
          error={saveMut.error instanceof Error ? saveMut.error.message : undefined}
          onClose={() => {
            setDrawer(null)
            setEditId(null)
          }}
          onSave={saveMut.mutate}
        />
      </PlerosSheet>

      <PlerosDialogModal
        open={!!historySkuId}
        onOpenChange={(o) => {
          if (!o) setHistorySkuId(null)
        }}
        title="Stock ledger"
        maxWidthClass="max-w-5xl"
      >
        {ledgerQ.isLoading ? (
          <div className="space-y-2 py-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        ) : ledgerQ.isError ? (
          <p className="text-sm py-6 max-w-xl" style={{ color: 'var(--c-danger)' }}>
            {formatApiReachabilityError(ledgerQ.error)}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="pleros-table text-sm">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Warehouse</th>
                  <th>Location</th>
                  <th>Batch</th>
                  <th>Event</th>
                  <th>Delta</th>
                  <th>After</th>
                  <th>Unit cost</th>
                  <th>Ref</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {(ledgerQ.data ?? []).map((e) => (
                  <tr key={e.id}>
                    <td className="text-pleros-text-3 whitespace-nowrap">{new Date(e.occurredAt).toLocaleString()}</td>
                    <td className="font-mono text-xs">{whMap.get(e.warehouseId) ?? 'Warehouse'}</td>
                    <td className="font-mono text-xs">{e.locationId ?? '—'}</td>
                    <td className="font-mono text-xs">{e.batchId || '—'}</td>
                    <td className="font-mono text-xs font-medium">{e.eventType}</td>
                    <td className="font-mono font-semibold" style={{ color: e.quantityDelta >= 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
                      {e.quantityDelta >= 0 ? '+' : ''}
                      {e.quantityDelta}
                    </td>
                    <td className="font-mono">{e.quantityAfter}</td>
                    <td className="font-mono text-xs">${Number(e.unitCost ?? 0).toFixed(2)}</td>
                    <td className="font-mono text-xs max-w-[140px] truncate" title={`${e.referenceType ?? ''} ${e.referenceId ?? ''}`}>
                      {e.referenceType ?? '—'} {e.referenceId ? `#${e.referenceId.slice(-6).toUpperCase()}` : ''}
                    </td>
                    <td className="text-xs text-pleros-text-2">{e.performedBy.startsWith('usr_') ? `User #${e.performedBy.slice(-4).toUpperCase()}` : e.performedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(ledgerQ.data ?? []).length === 0 && (
              <p className="text-sm text-pleros-text-3 py-8 text-center">No ledger entries yet.</p>
            )}
          </div>
        )}
      </PlerosDialogModal>

      <PlerosDialogModal
        open={!!adjustOpen}
        onOpenChange={(o) => {
          if (!o) setAdjustOpen(null)
        }}
        title="Adjust stock"
        maxWidthClass="max-w-md"
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setAdjustOpen(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!adjWarehouse || adjDelta === 0 || !adjReason.trim() || adjustMut.isPending}
              onClick={() => adjustMut.mutate()}
            >
              Apply
            </button>
          </div>
        }
      >
        {adjustOpen && (
          <>
            <p className="text-sm text-pleros-text-3 mb-4 font-mono">
              {adjustOpen.code} · {adjustOpen.name}
            </p>
            <label className="block text-sm mb-1 text-pleros-text-2">Warehouse</label>
            <select className="pleros-input mb-3" value={adjWarehouse} onChange={(e) => setAdjWarehouse(e.target.value)}>
              <option value="">Select…</option>
              {(warehousesQ.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code}
                </option>
              ))}
            </select>
            <label className="block text-sm mb-1 text-pleros-text-2">Quantity delta (+/-)</label>
            <input
              type="number"
              className="pleros-input mb-3"
              value={adjDelta || ''}
              onChange={(e) => setAdjDelta(parseInt(e.target.value, 10) || 0)}
            />
            <label className="block text-sm mb-1 text-pleros-text-2">Reason</label>
            <input
              className="pleros-input"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="Required — cycle count, damage, …"
            />
          </>
        )}
      </PlerosDialogModal>
    </div>
  )
}

function SkuDrawer({
  mode,
  editId,
  initial,
  stockLevels,
  loading,
  warehouses,
  saving,
  error,
  onClose,
  onSave,
}: {
  mode: 'new' | 'edit'
  editId: string | null
  initial?: Record<string, unknown>
  stockLevels?: StockLevelRow[]
  loading?: boolean
  warehouses: WarehouseRow[]
  saving: boolean
  error?: string
  onClose: () => void
  onSave: (p: SavePayload) => void
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cat, setCat] = useState('')
  const [sub, setSub] = useState('')
  const [barcode, setBarcode] = useState('')
  const [uom, setUom] = useState('EACH')
  const [weight, setWeight] = useState('')
  const [isTobacco, setIsTobacco] = useState(false)
  const [isRegulated, setIsRegulated] = useState(false)
  const [ageRestricted, setAgeRestricted] = useState(false)
  const [minimumAge, setMinimumAge] = useState('21')
  const [manufacturerId, setManufacturerId] = useState('')
  const [manufacturerDid, setManufacturerDid] = useState('')
  const [excise, setExcise] = useState('')
  const [cost, setCost] = useState('0')
  const [price, setPrice] = useState('0')
  const [minPrice, setMinPrice] = useState('')
  const [reorderPt, setReorderPt] = useState('0')
  const [reorderQty, setReorderQty] = useState('0')
  const [defWh, setDefWh] = useState('')
  const [defLoc, setDefLoc] = useState('')
  const [isActive, setIsActive] = useState(true)

  const applyLevelsForWarehouse = useCallback(
    (wh: string, levels: StockLevelRow[] | undefined) => {
      if (!levels?.length) {
        setDefLoc('')
        setReorderPt('0')
        setReorderQty('0')
        return
      }
      const row = levels.find((l) => l.warehouseId === wh && isNonBatchBatchId(l.batchId))
      if (row) {
        setDefLoc(row.locationId ?? '')
        setReorderPt(String(row.reorderPoint ?? 0))
        setReorderQty(String(row.reorderQty ?? 0))
      } else {
        setDefLoc('')
        setReorderPt('0')
        setReorderQty('0')
      }
    },
    [],
  )

  useEffect(() => {
    if (mode !== 'edit' || !initial) return
    setCode(String(initial.code ?? ''))
    setName(String(initial.name ?? ''))
    setDescription(String(initial.description ?? ''))
    setCat(String(initial.category ?? ''))
    setSub(String(initial.subcategory ?? ''))
    setBarcode(String(initial.barcode ?? ''))
    setUom(String(initial.unitOfMeasure ?? 'EACH'))
    setWeight(initial.weightGrams != null ? String(initial.weightGrams) : '')
    setIsTobacco(Boolean(initial.isTobacco))
    setIsRegulated(Boolean(initial.isRegulated))
    setAgeRestricted(Boolean(initial.ageRestricted ?? initial.isTobacco))
    setMinimumAge(initial.minimumAge != null ? String(initial.minimumAge) : initial.isTobacco ? '21' : '21')
    setManufacturerId(String(initial.manufacturerId ?? ''))
    setManufacturerDid(String(initial.manufacturerDid ?? ''))
    setExcise(String(initial.exciseTaxCategory ?? ''))
    setCost(String(initial.cost ?? '0'))
    setPrice(String(initial.price ?? '0'))
    setMinPrice(initial.minPrice != null ? String(initial.minPrice) : '')
    setIsActive(initial.isActive !== false)
  }, [mode, initial])

  useEffect(() => {
    if (mode !== 'edit' || stockLevels === undefined) return
    const nonBatch = stockLevels.filter((l) => isNonBatchBatchId(l.batchId))
    const primary = nonBatch[0]
    if (primary) {
      setDefWh(primary.warehouseId)
      applyLevelsForWarehouse(primary.warehouseId, stockLevels)
    } else {
      setDefWh('')
      setDefLoc('')
      setReorderPt('0')
      setReorderQty('0')
    }
  }, [mode, stockLevels, applyLevelsForWarehouse])

  useEffect(() => {
    if (mode !== 'new') return
    setCode('')
    setName('')
    setDescription('')
    setCat('')
    setSub('')
    setBarcode('')
    setUom('EACH')
    setWeight('')
    setIsTobacco(false)
    setIsRegulated(false)
    setAgeRestricted(false)
    setMinimumAge('21')
    setManufacturerId('')
    setManufacturerDid('')
    setExcise('')
    setCost('0')
    setPrice('0')
    setMinPrice('')
    setReorderPt('0')
    setReorderQty('0')
    setDefWh('')
    setDefLoc('')
    setIsActive(true)
  }, [mode])

  const onWarehouseSelect = (wh: string) => {
    setDefWh(wh)
    if (mode === 'edit' && stockLevels) applyLevelsForWarehouse(wh, stockLevels)
  }

  const submit = () => {
    const body: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      category: cat.trim() || 'General',
      cost: Number(cost),
      price: Number(price),
      unitOfMeasure: uom,
      isTobacco,
      isRegulated,
      ageRestricted: ageRestricted || isTobacco,
      minimumAge: ageRestricted || isTobacco ? Number(minimumAge) || 21 : null,
    }
    if (description.trim()) body.description = description.trim()
    if (sub.trim()) body.subcategory = sub.trim()
    if (barcode.trim()) body.barcode = barcode.trim()
    if (weight.trim()) body.weightGrams = Number(weight)
    if (manufacturerId.trim()) body.manufacturerId = manufacturerId.trim()
    else if (mode === 'edit') body.manufacturerId = null

    if (isTobacco) {
      if (manufacturerDid.trim()) body.manufacturerDid = manufacturerDid.trim()
      else if (mode === 'edit') body.manufacturerDid = null
      if (excise.trim()) body.exciseTaxCategory = excise.trim()
      else if (mode === 'edit') body.exciseTaxCategory = null
    } else if (mode === 'edit') {
      body.manufacturerDid = null
      body.exciseTaxCategory = null
    }

    if (minPrice.trim()) body.minPrice = Number(minPrice)
    else if (mode === 'edit') body.minPrice = null

    if (mode === 'edit') {
      body.isActive = isActive
    }

    if (mode === 'new') {
      if (defWh) {
        body.defaultWarehouseId = defWh
        if (defLoc.trim()) body.defaultLocationId = defLoc.trim()
        body.reorderPoint = Number(reorderPt) || 0
        body.reorderQty = Number(reorderQty) || 0
      }
      onSave({ sku: body })
      return
    }

    if (!editId) return

    let editStock: SavePayload['editStock'] | undefined
    if (defWh) {
      const row = stockLevels?.find((l) => l.warehouseId === defWh && isNonBatchBatchId(l.batchId))
      const reorderPoint = Number(reorderPt) || 0
      const reorderQtyN = Number(reorderQty) || 0
      if (row) {
        editStock = {
          mode: 'patch',
          levelId: row.id,
          warehouseId: defWh,
          locationId: defLoc,
          reorderPoint,
          reorderQty: reorderQtyN,
          skuId: editId,
        }
      } else {
        editStock = {
          mode: 'ensure',
          warehouseId: defWh,
          locationId: defLoc,
          reorderPoint,
          reorderQty: reorderQtyN,
          skuId: editId,
        }
      }
    }

    onSave({ sku: body, editStock })
  }

  return (
    <>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          {error && <p className="text-sm mb-3 text-red-400">{error}</p>}
          <label className="text-xs text-pleros-text-3">Code *</label>
          <input className="pleros-input mb-3" value={code} onChange={(e) => setCode(e.target.value)} />
          <label className="text-xs text-pleros-text-3">Name *</label>
          <input className="pleros-input mb-3" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="text-xs text-pleros-text-3">Description</label>
          <textarea className="pleros-input mb-3 min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} />
          <label className="text-xs text-pleros-text-3">Category *</label>
          <input className="pleros-input mb-3" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="e.g. Beverages" />
          <label className="text-xs text-pleros-text-3">Subcategory</label>
          <input className="pleros-input mb-3" value={sub} onChange={(e) => setSub(e.target.value)} />
          <label className="text-xs text-pleros-text-3">Barcode</label>
          <input className="pleros-input mb-3" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          <label className="text-xs text-pleros-text-3">Unit of measure</label>
          <select className="pleros-input mb-3" value={uom} onChange={(e) => setUom(e.target.value)}>
            {UOM_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <label className="text-xs text-pleros-text-3">Weight (grams)</label>
          <input className="pleros-input mb-3" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />

          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isTobacco}
              onChange={(e) => {
                const on = e.target.checked
                setIsTobacco(on)
                if (on) {
                  setAgeRestricted(true)
                  setIsRegulated(true)
                  if (!minimumAge.trim()) setMinimumAge('21')
                }
              }}
            />
            <span className="text-sm text-pleros-text">Is tobacco</span>
          </label>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input type="checkbox" checked={isRegulated} onChange={(e) => setIsRegulated(e.target.checked)} />
            <span className="text-sm text-pleros-text">Regulated product</span>
          </label>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ageRestricted || isTobacco}
              onChange={(e) => setAgeRestricted(e.target.checked)}
            />
            <span className="text-sm text-pleros-text">Age restricted</span>
          </label>
          {(ageRestricted || isTobacco) && (
            <>
              <label className="text-xs text-pleros-text-3">Minimum age</label>
              <input
                className="pleros-input mb-3 w-32"
                type="number"
                min={18}
                max={99}
                value={minimumAge}
                onChange={(e) => setMinimumAge(e.target.value)}
              />
            </>
          )}

          {isTobacco && (
            <>
              <label className="text-xs text-pleros-text-3">Manufacturer ID</label>
              <input className="pleros-input mb-3 font-mono text-sm" value={manufacturerId} onChange={(e) => setManufacturerId(e.target.value)} />
              <label className="text-xs text-pleros-text-3">Manufacturer DID</label>
              <input className="pleros-input mb-3 font-mono text-sm" value={manufacturerDid} onChange={(e) => setManufacturerDid(e.target.value)} />
              <label className="text-xs text-pleros-text-3">Excise tax category</label>
              <input className="pleros-input mb-3" value={excise} onChange={(e) => setExcise(e.target.value)} />
            </>
          )}

          {!isTobacco && (
            <>
              <label className="text-xs text-pleros-text-3">Manufacturer ID (optional)</label>
              <input className="pleros-input mb-3 font-mono text-sm" value={manufacturerId} onChange={(e) => setManufacturerId(e.target.value)} />
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-pleros-text-3">Cost</label>
              <input className="pleros-input" type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-pleros-text-3">Sell price</label>
              <input className="pleros-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          <label className="text-xs text-pleros-text-3 mt-3 block">Min price</label>
          <input className="pleros-input mb-3" type="number" step="0.01" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />

          <p className="text-sm text-pleros-text-2 mt-4 mb-2">Default stocking (non-batch row)</p>
          <label className="text-xs text-pleros-text-3">Warehouse</label>
          <select className="pleros-input mb-3" value={defWh} onChange={(e) => onWarehouseSelect(e.target.value)}>
            <option value="">—</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code}
              </option>
            ))}
          </select>
          <label className="text-xs text-pleros-text-3">Location label</label>
          <input className="pleros-input mb-3" value={defLoc} onChange={(e) => setDefLoc(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-pleros-text-3">Reorder point</label>
              <input className="pleros-input" type="number" value={reorderPt} onChange={(e) => setReorderPt(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-pleros-text-3">Reorder qty</label>
              <input className="pleros-input" type="number" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} />
            </div>
          </div>

          {mode === 'edit' && (
            <label className="flex items-center gap-2 mt-4 cursor-pointer">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              <span className="text-sm text-pleros-text">Active</span>
            </label>
          )}

          <div className="flex gap-2 justify-end mt-6">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || !code.trim() || !name.trim()}
              onClick={() => submit()}
            >
              {mode === 'new' ? 'Create' : 'Save'}
            </button>
          </div>
        </>
      )}
    </>
  )
}
