import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { axiosErr } from '@/lib/axios-error'
import { parseFormNumber, poLineProblems, type PoFormLine } from '@/lib/po-lines'

type PoStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'CLOSED' | 'CANCELLED'

type PurchaseOrder = {
  id: string
  number: string
  status: PoStatus
  notes?: string | null
  createdAt: string
  supplier?: { id: string; name: string; code: string }
  lines?: Array<{ id: string; lineNo: number; description: string; qtyOrdered: number; skuCode?: string | null }>
  /** Lines plus freight, duty and other charges, each counted once (from the server). */
  total?: number
}

type Supplier = {
  id: string
  name: string
  code: string
  email?: string | null
  phone?: string | null
}

const FILTERS: Array<{ label: string; value: '' | PoStatus }> = [
  { label: 'ALL', value: '' },
  { label: 'DRAFT', value: 'DRAFT' },
  { label: 'SUBMITTED', value: 'SUBMITTED' },
  { label: 'PARTIALLY_RECEIVED', value: 'PARTIALLY_RECEIVED' },
  { label: 'CLOSED', value: 'CLOSED' },
  { label: 'CANCELLED', value: 'CANCELLED' },
]

export default function PurchasingPage() {
  const qc = useQueryClient()
  const [searchParams] = useSearchParams()
  const prefillSkuId = searchParams.get('skuId') ?? ''
  const [tab, setTab] = useState<'pos' | 'suppliers'>('pos')
  const [statusFilter, setStatusFilter] = useState<'' | PoStatus>('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [supplierDrawer, setSupplierDrawer] = useState(false)
  const [prefillLine, setPrefillLine] = useState<{ skuCode: string; description: string; qtyOrdered: number } | null>(null)

  useEffect(() => {
    if (!prefillSkuId) return
    void (async () => {
      try {
        const suggestion = await api.get<{
          sku: { code: string; name: string }
          suggestedQty: number
        }>(`/skus/${encodeURIComponent(prefillSkuId)}/reorder-suggestion`)
        setPrefillLine({
          skuCode: suggestion.sku.code,
          description: suggestion.sku.name,
          qtyOrdered: suggestion.suggestedQty,
        })
        setDrawerOpen(true)
      } catch {
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
              onClick={() => setDrawerOpen(true)}
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
                    onClick={() => setDrawerOpen(true)}
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
                      <th className="pb-2 pr-4 text-right">Total</th>
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
                          <StatusBadge status={po.status} />
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-pleros-white">
                          {po.total != null ? `$${po.total.toFixed(2)}` : '—'}
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
              onClick={() => setSupplierDrawer(true)}
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
                    onClick={() => setSupplierDrawer(true)}
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
          onClose={() => setDrawerOpen(false)}
          onSubmit={(payload) => createPo.mutate(payload)}
          loading={createPo.isPending}
          error={createPo.error as Error | undefined}
        />
      )}

      {supplierDrawer && (
        <SupplierDrawer
          onClose={() => setSupplierDrawer(false)}
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
  prefillLine?: { skuCode: string; description: string; qtyOrdered: number } | null
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
      ? [{ key: 1, skuCode: props.prefillLine.skuCode, description: props.prefillLine.description, qtyOrdered: String(props.prefillLine.qtyOrdered), unitCost: '' }]
      : [{ key: 1, skuCode: '', description: '', qtyOrdered: '1', unitCost: '' }],
  )
  // Problems show once Create is pressed, so a fresh form isn't covered in red.
  const [showProblems, setShowProblems] = useState(false)
  // Every line needs a price: the supplier bill is built from it when goods arrive.
  const lineProblems = poLineProblems(lines)
  const formProblems = [!supplierId && 'Select a supplier', !number.trim() && 'Enter a PO number'].filter(Boolean) as string[]
  const hasProblems = formProblems.length > 0 || lineProblems.some((p) => p.length > 0)
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
        <label className="block mt-4 text-xs text-pleros-muted">Supplier</label>
        <select
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="">Select…</option>
          {props.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
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
        <label className="block mt-4 text-xs text-pleros-muted">PO number</label>
        <input
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
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
              <input
                placeholder="SKU code"
                aria-label={`Line ${idx + 1} SKU code`}
                className="rounded-md bg-pleros-surface-2 border border-pleros-border px-2 py-1.5 text-xs text-pleros-text"
                value={ln.skuCode}
                onChange={(e) => updateLine(idx, { skuCode: e.target.value })}
              />
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Quantity"
                aria-label={`Line ${idx + 1} quantity`}
                className="rounded-md bg-pleros-surface-2 border border-pleros-border px-2 py-1.5 text-xs text-pleros-text"
                value={ln.qtyOrdered}
                onChange={(e) => updateLine(idx, { qtyOrdered: e.target.value })}
              />
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
        {showProblems && formProblems.map((p) => (
          <p key={p} className="text-red-400 text-xs mt-1">{p}</p>
        ))}
        {showProblems && hasProblems && formProblems.length === 0 && (
          <p className="text-red-400 text-xs mt-1">Fix the lines marked in red.</p>
        )}
        {props.error && <p className="text-red-400 text-xs mt-2">{axiosErr(props.error)}</p>}
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
            disabled={props.loading || (showProblems && hasProblems)}
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
  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-md bg-pleros-surface border-l border-pleros-border p-6">
        <h2 className="text-lg font-semibold text-pleros-white">New supplier</h2>
        <input
          placeholder="Code"
          className="mt-4 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          placeholder="Name"
          className="mt-2 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Email"
          className="mt-2 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="Phone (optional)"
          className="mt-2 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {props.error && <p className="text-red-400 text-xs mt-2">{props.error.message}</p>}
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
            disabled={props.loading || !code || !name}
            className="flex-1 h-10 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-40"
            onClick={() =>
              props.onSubmit({
                code,
                name,
                email: email || undefined,
                phone: phone || undefined,
              })
            }
          >
            {props.loading ? 'Saving…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
