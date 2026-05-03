'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { EmptyState } from '@/components/cosmos/empty-state'

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

type LedgerRow = {
  id: string
  warehouseId: string
  eventType: string
  quantityDelta: number
  quantityAfter: number
  performedBy: string
  occurredAt: string
  referenceType?: string | null
}

const UOM_OPTIONS = ['EACH', 'CASE', 'PALLET']

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

  const [adjWarehouse, setAdjWarehouse] = useState('')
  const [adjDelta, setAdjDelta] = useState(0)
  const [adjReason, setAdjReason] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

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

  const ledgerQ = useQuery({
    queryKey: ['inventory', 'ledger', historySkuId],
    enabled: !!historySkuId,
    queryFn: () => api.get<LedgerRow[]>(`/inventory/ledger?skuId=${encodeURIComponent(historySkuId!)}&limit=80`),
  })

  const saveMut = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      if (drawer === 'edit' && editId) {
        await api.patch(`/skus/${encodeURIComponent(editId)}`, body)
      } else {
        await api.post('/skus', body)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skus'] })
      setDrawer(null)
      setEditId(null)
    },
  })

  const adjustMut = useMutation({
    mutationFn: async () => {
      if (!adjustOpen || !adjWarehouse) throw new Error('warehouse required')
      await api.post('/inventory/adjust', {
        skuId: adjustOpen.id,
        warehouseId: adjWarehouse,
        quantityDelta: adjDelta,
        reason: adjReason || 'Manual adjustment',
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['skus'] })
      setAdjustOpen(null)
      setAdjDelta(0)
      setAdjReason('')
      setAdjWarehouse('')
    },
  })

  const totalPages = Math.max(1, Math.ceil((skusQ.data?.total ?? 0) / pageSize))

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white" style={{ fontFamily: 'var(--font-display)' }}>
            Inventory
          </h1>
          <p className="text-cosmos-text-3 text-sm mt-1">SKUs, stock positions, and adjustments</p>
        </div>
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

      <div className="cosmos-card flex flex-wrap gap-4 items-end">
        <div className="min-w-[200px] flex-1">
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-cosmos-text-3">Search</label>
          <input
            className="cosmos-input"
            placeholder="Code or name"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-cosmos-text-3">Category</label>
          <select className="cosmos-input w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All</option>
            {(categoriesQ.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-cosmos-text-3">Warehouse</label>
          <select className="cosmos-input w-[220px]" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
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
          <span className="text-sm text-cosmos-text">In stock only</span>
        </label>
      </div>

      <div className="cosmos-card overflow-x-auto">
        {skusQ.isLoading ? (
          <div className="py-8 space-y-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        ) : skusQ.isError ? (
          <p className="text-sm py-8" style={{ color: 'var(--c-danger)' }}>
            {(skusQ.error as Error)?.message ?? 'Failed to load SKUs'}
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
            <table className="cosmos-table">
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
                      <Link href={`/inventory/${encodeURIComponent(s.id)}`} className="text-cosmos-accent hover:underline">
                        {s.code}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate">{s.name}</td>
                    <td className="text-cosmos-text-2 text-sm">{s.category}</td>
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
              <p className="text-sm text-cosmos-text-3">
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

      {(drawer === 'new' || drawer === 'edit') && (
        <SkuDrawer
          mode={drawer}
          initial={drawer === 'edit' ? editSkuQ.data : undefined}
          loading={drawer === 'edit' && editSkuQ.isLoading}
          warehouses={warehousesQ.data ?? []}
          saving={saveMut.isPending}
          error={saveMut.error instanceof Error ? saveMut.error.message : undefined}
          onClose={() => {
            setDrawer(null)
            setEditId(null)
          }}
          onSave={(payload) => saveMut.mutate(payload)}
        />
      )}

      {historySkuId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setHistorySkuId(null)}
        >
          <div className="cosmos-card max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-cosmos-white font-display">Stock ledger</h3>
              <button type="button" className="btn-ghost !py-1 !px-2" onClick={() => setHistorySkuId(null)}>
                Close
              </button>
            </div>
            {ledgerQ.isLoading ? (
              <div className="space-y-2 py-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton h-10 w-full" />
                ))}
              </div>
            ) : ledgerQ.isError ? (
              <p className="text-sm text-red-400 py-6">{(ledgerQ.error as Error)?.message}</p>
            ) : (
              <div className="overflow-y-auto flex-1">
                <table className="cosmos-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Event</th>
                      <th>Delta</th>
                      <th>After</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledgerQ.data ?? []).map((e) => (
                      <tr key={e.id}>
                        <td className="text-sm text-cosmos-text-3">{new Date(e.occurredAt).toLocaleString()}</td>
                        <td className="font-mono text-xs">{e.eventType}</td>
                        <td className="font-mono" style={{ color: e.quantityDelta >= 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
                          {e.quantityDelta >= 0 ? '+' : ''}
                          {e.quantityDelta}
                        </td>
                        <td className="font-mono">{e.quantityAfter}</td>
                        <td className="font-mono text-xs">{e.performedBy.slice(-8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(ledgerQ.data ?? []).length === 0 && (
                  <p className="text-sm text-cosmos-text-3 py-8 text-center">No ledger entries yet.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {adjustOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setAdjustOpen(null)}
        >
          <div className="cosmos-card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-2">Adjust stock</h3>
            <p className="text-sm text-cosmos-text-3 mb-4 font-mono">
              {adjustOpen.code} · {adjustOpen.name}
            </p>
            <label className="block text-sm mb-1 text-cosmos-text-2">Warehouse</label>
            <select className="cosmos-input mb-3" value={adjWarehouse} onChange={(e) => setAdjWarehouse(e.target.value)}>
              <option value="">Select…</option>
              {(warehousesQ.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code}
                </option>
              ))}
            </select>
            <label className="block text-sm mb-1 text-cosmos-text-2">Quantity delta (+/-)</label>
            <input
              type="number"
              className="cosmos-input mb-3"
              value={adjDelta || ''}
              onChange={(e) => setAdjDelta(parseInt(e.target.value, 10) || 0)}
            />
            <label className="block text-sm mb-1 text-cosmos-text-2">Reason</label>
            <input className="cosmos-input mb-4" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="Cycle count, damage, …" />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setAdjustOpen(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!adjWarehouse || adjDelta === 0 || adjustMut.isPending}
                onClick={() => adjustMut.mutate()}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SkuDrawer({
  mode,
  initial,
  loading,
  warehouses,
  saving,
  error,
  onClose,
  onSave,
}: {
  mode: 'new' | 'edit'
  initial?: Record<string, unknown>
  loading?: boolean
  warehouses: WarehouseRow[]
  saving: boolean
  error?: string
  onClose: () => void
  onSave: (body: Record<string, unknown>) => void
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
  const [manufacturerDid, setManufacturerDid] = useState('')
  const [excise, setExcise] = useState('')
  const [cost, setCost] = useState('0')
  const [price, setPrice] = useState('0')
  const [minPrice, setMinPrice] = useState('')
  const [reorderPt, setReorderPt] = useState('0')
  const [reorderQty, setReorderQty] = useState('0')
  const [defWh, setDefWh] = useState('')
  const [defLoc, setDefLoc] = useState('')

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
    setManufacturerDid(String(initial.manufacturerDid ?? ''))
    setExcise(String(initial.exciseTaxCategory ?? ''))
    setCost(String(initial.cost ?? '0'))
    setPrice(String(initial.price ?? '0'))
    setMinPrice(initial.minPrice != null ? String(initial.minPrice) : '')
    setReorderPt('0')
    setReorderQty('0')
    setDefWh('')
    setDefLoc('')
  }, [mode, initial])

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
    setManufacturerDid('')
    setExcise('')
    setCost('0')
    setPrice('0')
    setMinPrice('')
    setReorderPt('0')
    setReorderQty('0')
    setDefWh('')
    setDefLoc('')
  }, [mode])

  const submit = () => {
    const body: Record<string, unknown> = {
      code: code.trim(),
      name: name.trim(),
      category: cat.trim() || 'General',
      cost: Number(cost),
      price: Number(price),
      unitOfMeasure: uom,
      isTobacco,
    }
    if (description.trim()) body.description = description.trim()
    if (sub.trim()) body.subcategory = sub.trim()
    if (barcode.trim()) body.barcode = barcode.trim()
    if (weight.trim()) body.weightGrams = Number(weight)
    if (isTobacco) {
      if (manufacturerDid.trim()) body.manufacturerDid = manufacturerDid.trim()
      if (excise.trim()) body.exciseTaxCategory = excise.trim()
    }
    if (minPrice.trim()) body.minPrice = Number(minPrice)
    if (mode === 'new') {
      if (defWh) {
        body.defaultWarehouseId = defWh
        if (defLoc.trim()) body.defaultLocationId = defLoc.trim()
        body.reorderPoint = Number(reorderPt) || 0
        body.reorderQty = Number(reorderQty) || 0
      }
    }
    onSave(body)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="w-full max-w-lg h-full overflow-y-auto cosmos-card rounded-none border-l"
        style={{ borderRadius: 0, borderColor: 'var(--c-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-cosmos-white font-display mb-4">{mode === 'new' ? 'New SKU' : 'Edit SKU'}</h3>
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            {error && <p className="text-sm mb-3 text-red-400">{error}</p>}
            <label className="text-xs text-cosmos-text-3">Code *</label>
            <input className="cosmos-input mb-3" value={code} onChange={(e) => setCode(e.target.value)} />
            <label className="text-xs text-cosmos-text-3">Name *</label>
            <input className="cosmos-input mb-3" value={name} onChange={(e) => setName(e.target.value)} />
            <label className="text-xs text-cosmos-text-3">Description</label>
            <textarea className="cosmos-input mb-3 min-h-[72px]" value={description} onChange={(e) => setDescription(e.target.value)} />
            <label className="text-xs text-cosmos-text-3">Category *</label>
            <input className="cosmos-input mb-3" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="e.g. Beverages" />
            <label className="text-xs text-cosmos-text-3">Subcategory</label>
            <input className="cosmos-input mb-3" value={sub} onChange={(e) => setSub(e.target.value)} />
            <label className="text-xs text-cosmos-text-3">Barcode</label>
            <input className="cosmos-input mb-3" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            <label className="text-xs text-cosmos-text-3">Unit of measure</label>
            <select className="cosmos-input mb-3" value={uom} onChange={(e) => setUom(e.target.value)}>
              {UOM_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <label className="text-xs text-cosmos-text-3">Weight (grams)</label>
            <input className="cosmos-input mb-3" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input type="checkbox" checked={isTobacco} onChange={(e) => setIsTobacco(e.target.checked)} />
              <span className="text-sm text-cosmos-text">Tobacco / regulated</span>
            </label>
            {isTobacco && (
              <>
                <label className="text-xs text-cosmos-text-3">Manufacturer DID</label>
                <input className="cosmos-input mb-3 font-mono text-sm" value={manufacturerDid} onChange={(e) => setManufacturerDid(e.target.value)} />
                <label className="text-xs text-cosmos-text-3">Excise tax category</label>
                <input className="cosmos-input mb-3" value={excise} onChange={(e) => setExcise(e.target.value)} />
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-cosmos-text-3">Cost</label>
                <input className="cosmos-input" type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-cosmos-text-3">Sell price</label>
                <input className="cosmos-input" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            </div>
            <label className="text-xs text-cosmos-text-3 mt-3 block">Min price</label>
            <input className="cosmos-input mb-3" type="number" step="0.01" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} />

            {mode === 'new' && (
              <>
                <p className="text-sm text-cosmos-text-2 mt-4 mb-2">Default stocking location (optional)</p>
                <label className="text-xs text-cosmos-text-3">Warehouse</label>
                <select className="cosmos-input mb-3" value={defWh} onChange={(e) => setDefWh(e.target.value)}>
                  <option value="">—</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code}
                    </option>
                  ))}
                </select>
                <label className="text-xs text-cosmos-text-3">Location label</label>
                <input className="cosmos-input mb-3" value={defLoc} onChange={(e) => setDefLoc(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-cosmos-text-3">Reorder point</label>
                    <input className="cosmos-input" type="number" value={reorderPt} onChange={(e) => setReorderPt(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-cosmos-text-3">Reorder qty</label>
                    <input className="cosmos-input" type="number" value={reorderQty} onChange={(e) => setReorderQty(e.target.value)} />
                  </div>
                </div>
              </>
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
      </div>
    </div>
  )
}
