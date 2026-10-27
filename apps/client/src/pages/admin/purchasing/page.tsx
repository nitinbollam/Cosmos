import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { EmptyState } from '@/components/pleros/empty-state'
import { axiosErr } from '@/lib/axios-error'
import { parseFormNumber, poLineProblems, type PoFormLine } from '@/lib/po-lines'
import { purchaseOrderStatusLabel, type PurchaseOrderStatus } from '@/lib/purchasing-status'

type PoStatus = PurchaseOrderStatus

type PurchaseOrder = {
  id: string
  number: string
  status: PoStatus
  notes?: string | null
  createdAt: string
  supplier?: { id: string; name: string; code: string }
  lines?: Array<{ id: string; lineNo: number; description: string; qtyOrdered: number; skuCode?: string | null }>
}

type Supplier = {
  id: string
  name: string
  code: string
  email?: string | null
  phone?: string | null
}

const FILTERS: Array<{ label: string; value: '' | PoStatus }> = [
  { label: 'All', value: '' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Pending Approval', value: 'PENDING_APPROVAL' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Partially Received', value: 'PARTIALLY_RECEIVED' },
  { label: 'Closed', value: 'CLOSED' },
  { label: 'Cancelled', value: 'CANCELLED' },
]

export default function PurchasingPage() {
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const prefillSkuId = searchParams.get('skuId') ?? ''
  const [tab, setTab] = useState<'pos' | 'suppliers'>('pos')
  const [statusFilter, setStatusFilter] = useState<'' | PoStatus>('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [supplierDrawer, setSupplierDrawer] = useState(false)
  const [prefillLine, setPrefillLine] = useState<{ skuId: string; skuCode: string; description: string; qtyOrdered: number } | null>(null)

  useEffect(() => {
    setPrefillLine(null)
    if (!prefillSkuId) return
    void (async () => {
      try {
        const suggestion = await api.get<{
          suggestedQty: number
        }>(`/skus/${encodeURIComponent(prefillSkuId)}/reorder-suggestion`)
        const sku = await api.get<{ id: string; code: string; name: string; isActive: boolean }>(
          `/skus/${encodeURIComponent(prefillSkuId)}`,
        )
        if (!sku.isActive) {
          createPo.reset()
          setDrawerOpen(true)
          return
        }
        setPrefillLine({
          skuId: sku.id,
          skuCode: sku.code,
          description: sku.name,
          qtyOrdered: suggestion.suggestedQty,
        })
        createPo.reset()
        setDrawerOpen(true)
      } catch {
        setPrefillLine(null)
        createPo.reset()
        setDrawerOpen(true)
      }
    })()
  }, [prefillSkuId])

  const posQuery = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () =>
      statusFilter
        ? api.get(`/purchase-orders?status=${encodeURIComponent(statusFilter)}`)
        : api.get('/purchase-orders'),
    enabled: tab === 'pos',
    refetchInterval: 5000,
  })

  const suppliers = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
    enabled: tab === 'pos' || tab === 'suppliers',
  })

  const warehouses = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses'),
    enabled: drawerOpen,
  })

  const createPo = useMutation({
    mutationFn: (body: {
      supplierId: string
      number: string
      notes?: string
      lines: Array<{ lineNo: number; skuCode?: string; description: string; qtyOrdered: number }>
    }) => api.post<PurchaseOrder>('/purchase-orders', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      void qc.invalidateQueries({ queryKey: ['orders'] })
      setDrawerOpen(false)
    },
  })

  const createSupplier = useMutation({
    mutationFn: (body: { code: string; name: string; email?: string; phone?: string }) =>
      api.post('/suppliers', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
      setSupplierDrawer(false)
    },
  })

  const openPoDrawer = () => {
    createPo.reset()
    setDrawerOpen(true)
  }
  const closePoDrawer = () => {
    createPo.reset()
    setDrawerOpen(false)
  }
  const openSupplierDrawer = () => {
    createSupplier.reset()
    setSupplierDrawer(true)
  }
  const closeSupplierDrawer = () => {
    createSupplier.reset()
    setSupplierDrawer(false)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white">Purchasing</h1>
          <p className="text-pleros-muted text-sm mt-1">Purchase orders and suppliers.</p>
        </div>
        <div className="flex rounded-lg border border-pleros-border overflow-hidden">
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'pos' ? 'bg-pleros-primary text-white' : 'text-pleros-text'}`}
            onClick={() => setTab('pos')}
          >
            Purchase orders
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'suppliers' ? 'bg-pleros-primary text-white' : 'text-pleros-text'}`}
            onClick={() => setTab('suppliers')}
          >
            Suppliers
          </button>
        </div>
      </div>

      {tab === 'pos' && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                  statusFilter === f.value
                    ? 'border-pleros-primary bg-pleros-primary/20 text-pleros-white'
                    : 'border-pleros-border text-pleros-muted'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={openPoDrawer}
              className="ml-auto h-9 px-4 rounded-md bg-pleros-primary text-white text-sm"
            >
              New PO
            </button>
          </div>

          <Card>
            <CardTitle>Orders</CardTitle>
            {posQuery.isLoading ? (
              <p className="text-sm text-pleros-muted mt-3">Loading…</p>
            ) : posQuery.isError ? (
              <p className="text-sm text-red-400 mt-3">Could not load purchase orders.</p>
            ) : (posQuery.data ?? []).length === 0 ? (
              <EmptyState
                icon="📦"
                title="No purchase orders"
                description={statusFilter ? 'Try clearing the status filter or create a new PO.' : 'Create a purchase order to get started.'}
                action={
                  <button
                    type="button"
                    onClick={openPoDrawer}
                    className="h-9 px-4 rounded-md bg-pleros-primary text-white text-sm"
                  >
                    New PO
                  </button>
                }
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-pleros-muted border-b border-pleros-border">
                      <th className="pb-2 pr-4">PO #</th>
                      <th className="pb-2 pr-4">Supplier</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Created</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(posQuery.data ?? []).map((po) => (
                      <tr key={po.id} className="border-b border-pleros-border/60">
                        <td className="py-2 pr-4 font-mono text-pleros-white">{po.number}</td>
                        <td className="py-2 pr-4 text-pleros-text">{po.supplier?.name ?? '—'}</td>
                        <td className="py-2 pr-4">
                          <span className="inline-flex rounded-md border border-pleros-border px-2.5 py-1 text-xs font-semibold text-pleros-text">
                            {purchaseOrderStatusLabel(po.status)}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-pleros-muted">
                          {new Date(po.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2">
                          <Link to={adminPath(`/purchasing/${po.id}`)} className="text-pleros-primary text-xs">
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'suppliers' && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={openSupplierDrawer}
              className="h-9 px-4 rounded-md bg-pleros-primary text-white text-sm"
            >
              New supplier
            </button>
          </div>
          <Card>
            <CardTitle>Suppliers</CardTitle>
            {suppliers.isLoading ? (
              <p className="text-sm text-pleros-muted mt-3">Loading…</p>
            ) : suppliers.isError ? (
              <p className="text-sm text-red-400 mt-3">Could not load suppliers.</p>
            ) : (suppliers.data ?? []).length === 0 ? (
              <EmptyState
                icon="🏭"
                title="No suppliers"
                description="Add a supplier before creating purchase orders."
                action={
                  <button
                    type="button"
                  onClick={openSupplierDrawer}
                    className="h-9 px-4 rounded-md bg-pleros-primary text-white text-sm"
                  >
                    New supplier
                  </button>
                }
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-pleros-muted border-b border-pleros-border">
                      <th className="pb-2 pr-4">Name</th>
                      <th className="pb-2 pr-4">Code</th>
                      <th className="pb-2 pr-4">Email</th>
                      <th className="pb-2">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(suppliers.data ?? []).map((s) => (
                      <tr key={s.id} className="border-b border-pleros-border/60">
                        <td className="py-2 pr-4 text-pleros-white">{s.name}</td>
                        <td className="py-2 pr-4 font-mono text-pleros-muted">{s.code}</td>
                        <td className="py-2 pr-4 text-pleros-muted">{s.email ?? '—'}</td>
                        <td className="py-2 text-pleros-muted">{s.phone ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {drawerOpen && (
        <PoDrawer
          suppliers={suppliers.data ?? []}
          warehouses={warehouses.data ?? []}
          prefillLine={prefillLine}
          onClose={closePoDrawer}
          onSubmit={(payload) => createPo.mutate(payload)}
          loading={createPo.isPending}
          error={createPo.error as Error | undefined}
        />
      )}

      {supplierDrawer && (
        <SupplierDrawer
          onClose={closeSupplierDrawer}
          onSubmit={(b) => createSupplier.mutate(b)}
          loading={createSupplier.isPending}
          error={createSupplier.error as Error | undefined}
        />
      )}
    </div>
  )
}

function PoDrawer(props: {
  suppliers: Supplier[]
  warehouses: Array<{ id: string; name: string }>
  prefillLine?: { skuId: string; skuCode: string; description: string; qtyOrdered: number } | null
  onClose: () => void
  onSubmit: (body: {
    supplierId: string
    number: string
    notes?: string
    lines: Array<{ lineNo: number; skuCode?: string; description: string; qtyOrdered: number; unitCost: number }>
  }) => void
  loading: boolean
  error?: Error
}) {
  const [supplierId, setSupplierId] = useState('')
  const [number, setNumber] = useState(`PO-${Date.now().toString(36).toUpperCase()}`)
  const [notes, setNotes] = useState(props.prefillLine ? 'Low-stock replenishment' : '')
  const [warehouseNote, setWarehouseNote] = useState('')
  const [lines, setLines] = useState<PoFormLine[]>(() =>
    props.prefillLine
      ? [{ key: 1, skuId: props.prefillLine.skuId, skuIsActive: true, skuCode: props.prefillLine.skuCode, description: props.prefillLine.description, qtyOrdered: String(props.prefillLine.qtyOrdered), unitCost: '' }]
      : [{ key: 1, skuCode: '', description: '', qtyOrdered: '1', unitCost: '' }],
  )
  // Problems show once Create is pressed, so a fresh form isn't covered in red.
  const [showProblems, setShowProblems] = useState(false)
  // Every line needs a price: the supplier bill is built from it when goods arrive.
  const lineProblems = poLineProblems(lines)
  const hasProblems = !supplierId || !number.trim() || lineProblems.some((p) => p.length > 0)
  const lineTotal = (l: PoFormLine) => {
    const cost = parseFormNumber(l.unitCost)
    const qty = parseFormNumber(l.qtyOrdered)
    return cost >= 0 && Number.isInteger(qty) && qty > 0 ? cost * qty : null
  }
  const poTotal = lines.reduce((sum, l) => sum + (lineTotal(l) ?? 0), 0)
  const updateLine = (idx: number, patch: Partial<PoFormLine>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)))

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-lg bg-pleros-surface border-l border-pleros-border p-6 overflow-y-auto">
        <h2 className="text-lg font-semibold text-pleros-white">New purchase order</h2>
        <label className="block mt-4 text-xs text-pleros-muted" htmlFor="po-supplier">Supplier</label>
        <select
          id="po-supplier"
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          aria-invalid={showProblems && !supplierId}
          aria-describedby={showProblems && !supplierId ? 'po-supplier-error' : undefined}
        >
          <option value="">Select…</option>
          {props.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
        {showProblems && !supplierId && <p id="po-supplier-error" className="mt-1 text-xs text-red-400">Select a supplier.</p>}
        <label className="block mt-4 text-xs text-pleros-muted">Warehouse (for notes)</label>
        <select
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={warehouseNote}
          onChange={(e) => setWarehouseNote(e.target.value)}
        >
          <option value="">Optional…</option>
          {props.warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <label className="block mt-4 text-xs text-pleros-muted" htmlFor="po-number">PO number</label>
        <input
          id="po-number"
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          aria-invalid={showProblems && !number.trim()}
          aria-describedby={showProblems && !number.trim() ? 'po-number-error' : undefined}
        />
        {showProblems && !number.trim() && <p id="po-number-error" className="text-red-400 text-xs mt-1">Enter a PO number.</p>}
        {lines.map((ln, idx) => {
          const problems = showProblems ? lineProblems[idx]! : []
          const total = lineTotal(ln)
          return (
            <div
              key={ln.key}
              className={`mt-4 grid grid-cols-2 gap-2 border rounded-md p-3 ${problems.length ? 'border-red-400/60' : 'border-pleros-border'}`}
            >
              <div className="col-span-2 flex items-center justify-between text-xs text-pleros-muted">
                <span>Line {idx + 1}</span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="text-pleros-muted hover:text-red-400"
                    aria-label={`Remove line ${idx + 1}`}
                    onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <PoSkuSelector
                lineNumber={idx + 1}
                skuId={ln.skuId}
                skuCode={ln.skuCode}
                error={showProblems ? problems.find((p) => p.includes('SKU')) : undefined}
                onSelect={(sku) => updateLine(idx, {
                  skuId: sku.id,
                  skuIsActive: sku.isActive,
                  skuCode: sku.code,
                  description: ln.description.trim() ? ln.description : sku.name,
                })}
                onClear={() => updateLine(idx, { skuId: undefined, skuIsActive: undefined, skuCode: '', description: '' })}
              />
              <div>
                <label htmlFor={`po-line-${idx + 1}-quantity`} className="mb-1 block text-xs text-pleros-muted">Quantity</label>
                <input
                  id={`po-line-${idx + 1}-quantity`}
                  type="number"
                  min={1}
                  step={1}
                  aria-label={`Line ${idx + 1} quantity`}
                  aria-invalid={showProblems && problems.some((p) => p.startsWith('Quantity'))}
                  className="w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-2 py-1.5 text-xs text-pleros-text"
                  value={ln.qtyOrdered}
                  onChange={(e) => updateLine(idx, { qtyOrdered: e.target.value })}
                />
              </div>
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="Unit cost ($)"
                aria-label={`Line ${idx + 1} unit cost in dollars`}
                className="rounded-md bg-pleros-surface-2 border border-pleros-border px-2 py-1.5 text-xs text-pleros-text"
                value={ln.unitCost}
                onChange={(e) => updateLine(idx, { unitCost: e.target.value })}
              />
              <span className="self-center text-xs text-pleros-muted">
                {total != null ? `Line total $${total.toFixed(2)}` : 'Enter a quantity and unit cost'}
              </span>
              <input
                placeholder="Description (defaults to the SKU name)"
                aria-label={`Line ${idx + 1} description`}
                className="col-span-2 rounded-md bg-pleros-surface-2 border border-pleros-border px-2 py-1.5 text-xs text-pleros-text"
                value={ln.description}
                onChange={(e) => updateLine(idx, { description: e.target.value })}
              />
              {problems.length > 0 && (
                <ul className="col-span-2 text-xs text-red-400 list-disc pl-4">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
        <button
          type="button"
          className="mt-2 text-xs text-pleros-primary"
          onClick={() =>
            setLines((ls) => [
              ...ls,
              { key: Math.max(0, ...ls.map((l) => l.key)) + 1, skuCode: '', description: '', qtyOrdered: '1', unitCost: '' },
            ])
          }
        >
          + Add line
        </button>
        <label className="block mt-4 text-xs text-pleros-muted">Notes</label>
        <textarea
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <p className="mt-3 text-sm text-pleros-white">PO total ${poTotal.toFixed(2)}</p>
        {showProblems && hasProblems && <p role="alert" className="text-red-400 text-xs mt-2">Fix the fields marked above before creating the purchase order.</p>}
        {props.error && <p role="alert" className="text-red-400 text-xs mt-2">Could not create purchase order: {axiosErr(props.error)}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-md border border-pleros-border text-pleros-text text-sm"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={props.loading}
            className="flex-1 h-10 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-40"
            onClick={() => {
              setShowProblems(true)
              if (hasProblems) return
              const wh = props.warehouses.find((w) => w.id === warehouseNote)
              const mergedNotes = [notes, wh ? `Warehouse: ${wh.name}` : ''].filter(Boolean).join('\n')
              props.onSubmit({
                supplierId,
                number: number.trim(),
                notes: mergedNotes || undefined,
                lines: lines.map((l, i) => ({
                  lineNo: i + 1,
                  skuCode: l.skuCode.trim(),
                  description: l.description.trim(),
                  qtyOrdered: parseFormNumber(l.qtyOrdered),
                  unitCost: parseFormNumber(l.unitCost),
                })),
              })
            }}
          >
            {props.loading ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

type SkuSearchResult = { id: string; code: string; name: string; isActive: boolean }

function PoSkuSelector(props: {
  lineNumber: number
  skuId?: string
  skuCode: string
  error?: string
  onSelect: (sku: SkuSearchResult) => void
  onClear: () => void
}) {
  const [search, setSearch] = useState('')
  const results = useQuery<{ items: SkuSearchResult[] }>({
    queryKey: ['purchase-order-sku-search', search],
    enabled: search.trim().length > 0,
    queryFn: () => {
      const params = new URLSearchParams({ page: '1', pageSize: '12', search: search.trim() })
      return api.get(`/skus?${params.toString()}`)
    },
  })
  const listId = `po-line-${props.lineNumber}-sku-options`
  const activeSkus = (results.data?.items ?? []).filter((sku) => sku.isActive)

  return (
    <div className="col-span-2 relative">
      <label htmlFor={`po-line-${props.lineNumber}-sku-search`} className="mb-1 block text-xs text-pleros-muted">
        SKU
      </label>
      {props.skuId ? (
        <div className="flex items-center justify-between rounded-md border border-pleros-border bg-pleros-surface-2 px-2 py-2 text-xs text-pleros-text">
          <span>{props.skuCode} selected</span>
          <button type="button" className="text-pleros-primary" onClick={props.onClear}>
            Change SKU
          </button>
        </div>
      ) : (
        <input
          id={`po-line-${props.lineNumber}-sku-search`}
          role="combobox"
          aria-label={`Line ${props.lineNumber} SKU`}
          aria-autocomplete="list"
          aria-expanded={search.trim().length > 0}
          aria-controls={listId}
          aria-invalid={Boolean(props.error)}
          aria-describedby={props.error ? `po-line-${props.lineNumber}-sku-error` : undefined}
          autoComplete="off"
          placeholder="Search SKU by code or name…"
          className="w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-2 py-1.5 text-xs text-pleros-text"
          value={search}
          onChange={(e) => {
            props.onClear()
            setSearch(e.target.value)
          }}
        />
      )}
      {props.error && <p id={`po-line-${props.lineNumber}-sku-error`} className="mt-1 text-xs text-red-400">{props.error}</p>}
      {!props.skuId && search.trim() && (
        <div id={listId} role="listbox" className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-pleros-border bg-pleros-surface shadow-lg">
          {results.isLoading ? (
            <p className="px-3 py-2 text-xs text-pleros-muted">Searching…</p>
          ) : results.isError ? (
            <p role="alert" className="px-3 py-2 text-xs text-red-400">Could not search SKUs.</p>
          ) : activeSkus.length === 0 ? (
            <p className="px-3 py-2 text-xs text-pleros-muted">No matching SKUs.</p>
          ) : (
            activeSkus.map((sku) => (
              <button
                key={sku.id}
                type="button"
                role="option"
                aria-selected={false}
                className="block w-full px-3 py-2 text-left text-xs text-pleros-text hover:bg-pleros-surface-2"
                onClick={() => {
                  props.onSelect(sku)
                  setSearch('')
                }}
              >
                <span className="font-mono">{sku.code}</span><span className="ml-2">{sku.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function SupplierDrawer(props: {
  onClose: () => void
  onSubmit: (body: { code: string; name: string; email?: string; phone?: string }) => void
  loading: boolean
  error?: Error
}) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [showProblems, setShowProblems] = useState(false)
  const fieldErrors = {
    code: showProblems && !code.trim() ? 'Enter a supplier code.' : '',
    name: showProblems && !name.trim() ? 'Enter a supplier name.' : '',
  }
  const hasProblems = Boolean(fieldErrors.code || fieldErrors.name)
  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-md bg-pleros-surface border-l border-pleros-border p-6">
        <h2 className="text-lg font-semibold text-pleros-white">New supplier</h2>
        <label htmlFor="supplier-code" className="mt-4 block text-xs text-pleros-muted">Supplier code</label>
        <input
          id="supplier-code"
          className="mt-4 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={Boolean(fieldErrors.code)}
          aria-describedby={fieldErrors.code ? 'supplier-code-error' : undefined}
        />
        {fieldErrors.code && <p id="supplier-code-error" className="mt-1 text-xs text-red-400">{fieldErrors.code}</p>}
        <label htmlFor="supplier-name" className="mt-3 block text-xs text-pleros-muted">Supplier name</label>
        <input
          id="supplier-name"
          className="mt-2 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? 'supplier-name-error' : undefined}
        />
        {fieldErrors.name && <p id="supplier-name-error" className="mt-1 text-xs text-red-400">{fieldErrors.name}</p>}
        <label htmlFor="supplier-email" className="mt-3 block text-xs text-pleros-muted">Email (optional)</label>
        <input
          id="supplier-email"
          type="email"
          className="mt-2 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label htmlFor="supplier-phone" className="mt-3 block text-xs text-pleros-muted">Phone (optional)</label>
        <input
          id="supplier-phone"
          className="mt-2 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {hasProblems && <p role="alert" className="text-red-400 text-xs mt-2">Complete the required supplier fields.</p>}
        {props.error && <p role="alert" className="text-red-400 text-xs mt-2">Could not create supplier: {axiosErr(props.error)}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-md border border-pleros-border text-sm text-pleros-text"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={props.loading}
            className="flex-1 h-10 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-40"
            onClick={() => {
              setShowProblems(true)
              if (!code.trim() || !name.trim()) return
              props.onSubmit({
                code: code.trim(),
                name: name.trim(),
                email: email.trim() || undefined,
                phone: phone.trim() || undefined,
              })
            }}
          >
            {props.loading ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
