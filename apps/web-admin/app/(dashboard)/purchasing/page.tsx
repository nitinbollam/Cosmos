'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'

type PoStatus = 'DRAFT' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'CLOSED' | 'CANCELLED'

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
  { label: 'ALL', value: '' },
  { label: 'DRAFT', value: 'DRAFT' },
  { label: 'SUBMITTED', value: 'SUBMITTED' },
  { label: 'PARTIALLY_RECEIVED', value: 'PARTIALLY_RECEIVED' },
  { label: 'CLOSED', value: 'CLOSED' },
  { label: 'CANCELLED', value: 'CANCELLED' },
]

export default function PurchasingPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'pos' | 'suppliers'>('pos')
  const [statusFilter, setStatusFilter] = useState<'' | PoStatus>('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [supplierDrawer, setSupplierDrawer] = useState(false)

  const posQuery = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () =>
      statusFilter
        ? api.get(`/purchase-orders?status=${encodeURIComponent(statusFilter)}`)
        : api.get('/purchase-orders'),
    enabled: tab === 'pos',
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
          <h1 className="text-2xl font-bold text-cosmos-white">Purchasing</h1>
          <p className="text-cosmos-muted text-sm mt-1">Purchase orders and suppliers.</p>
        </div>
        <div className="flex rounded-lg border border-cosmos-border overflow-hidden">
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'pos' ? 'bg-cosmos-primary text-white' : 'text-cosmos-text'}`}
            onClick={() => setTab('pos')}
          >
            Purchase orders
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'suppliers' ? 'bg-cosmos-primary text-white' : 'text-cosmos-text'}`}
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
                    ? 'border-cosmos-primary bg-cosmos-primary/20 text-cosmos-white'
                    : 'border-cosmos-border text-cosmos-muted'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="ml-auto h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
            >
              New PO
            </button>
          </div>

          <Card>
            <CardTitle>Orders</CardTitle>
            {posQuery.isLoading ? (
              <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
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
                    className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
                  >
                    New PO
                  </button>
                }
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                      <th className="pb-2 pr-4">PO #</th>
                      <th className="pb-2 pr-4">Supplier</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Created</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(posQuery.data ?? []).map((po) => (
                      <tr key={po.id} className="border-b border-cosmos-border/60">
                        <td className="py-2 pr-4 font-mono text-cosmos-white">{po.number}</td>
                        <td className="py-2 pr-4 text-cosmos-text">{po.supplier?.name ?? '—'}</td>
                        <td className="py-2 pr-4">
                          <StatusBadge status={po.status} />
                        </td>
                        <td className="py-2 pr-4 text-cosmos-muted">
                          {new Date(po.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2">
                          <Link href={`/purchasing/${po.id}`} className="text-cosmos-primary text-xs">
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
              className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
            >
              New supplier
            </button>
          </div>
          <Card>
            <CardTitle>Suppliers</CardTitle>
            {suppliers.isLoading ? (
              <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
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
                    className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
                  >
                    New supplier
                  </button>
                }
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                      <th className="pb-2 pr-4">Name</th>
                      <th className="pb-2 pr-4">Code</th>
                      <th className="pb-2 pr-4">Email</th>
                      <th className="pb-2">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(suppliers.data ?? []).map((s) => (
                      <tr key={s.id} className="border-b border-cosmos-border/60">
                        <td className="py-2 pr-4 text-cosmos-white">{s.name}</td>
                        <td className="py-2 pr-4 font-mono text-cosmos-muted">{s.code}</td>
                        <td className="py-2 pr-4 text-cosmos-muted">{s.email ?? '—'}</td>
                        <td className="py-2 text-cosmos-muted">{s.phone ?? '—'}</td>
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
  onClose: () => void
  onSubmit: (body: {
    supplierId: string
    number: string
    notes?: string
    lines: Array<{ lineNo: number; skuCode?: string; description: string; qtyOrdered: number }>
  }) => void
  loading: boolean
  error?: Error
}) {
  const [supplierId, setSupplierId] = useState('')
  const [number, setNumber] = useState(`PO-${Date.now().toString(36).toUpperCase()}`)
  const [notes, setNotes] = useState('')
  const [warehouseNote, setWarehouseNote] = useState('')
  const [lines, setLines] = useState([{ lineNo: 1, skuCode: '', description: '', qtyOrdered: 1 }])

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-lg bg-cosmos-surface border-l border-cosmos-border p-6 overflow-y-auto">
        <h2 className="text-lg font-semibold text-cosmos-white">New purchase order</h2>
        <label className="block mt-4 text-xs text-cosmos-muted">Supplier</label>
        <select
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
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
        <label className="block mt-4 text-xs text-cosmos-muted">Warehouse (for notes)</label>
        <select
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
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
        <label className="block mt-4 text-xs text-cosmos-muted">PO number</label>
        <input
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        {lines.map((ln, idx) => (
          <div key={ln.lineNo} className="mt-4 grid grid-cols-2 gap-2 border border-cosmos-border rounded-md p-3">
            <input
              placeholder="SKU code"
              className="rounded-md bg-cosmos-surface-2 border border-cosmos-border px-2 py-1.5 text-xs text-cosmos-text"
              value={ln.skuCode}
              onChange={(e) => {
                const next = [...lines]
                next[idx] = { ...ln, skuCode: e.target.value }
                setLines(next)
              }}
            />
            <input
              type="number"
              min={1}
              className="rounded-md bg-cosmos-surface-2 border border-cosmos-border px-2 py-1.5 text-xs text-cosmos-text"
              value={ln.qtyOrdered}
              onChange={(e) => {
                const next = [...lines]
                next[idx] = { ...ln, qtyOrdered: Number(e.target.value) || 1 }
                setLines(next)
              }}
            />
            <input
              placeholder="Description"
              className="col-span-2 rounded-md bg-cosmos-surface-2 border border-cosmos-border px-2 py-1.5 text-xs text-cosmos-text"
              value={ln.description}
              onChange={(e) => {
                const next = [...lines]
                next[idx] = { ...ln, description: e.target.value }
                setLines(next)
              }}
            />
          </div>
        ))}
        <button
          type="button"
          className="mt-2 text-xs text-cosmos-primary"
          onClick={() =>
            setLines((l) => [...l, { lineNo: l.length + 1, skuCode: '', description: '', qtyOrdered: 1 }])
          }
        >
          + Add line
        </button>
        <label className="block mt-4 text-xs text-cosmos-muted">Notes</label>
        <textarea
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        {props.error && <p className="text-red-400 text-xs mt-2">{props.error.message}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-md border border-cosmos-border text-cosmos-text text-sm"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={props.loading || !supplierId}
            className="flex-1 h-10 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
            onClick={() => {
              const wh = props.warehouses.find((w) => w.id === warehouseNote)
              const mergedNotes = [notes, wh ? `Warehouse: ${wh.name}` : ''].filter(Boolean).join('\n')
              props.onSubmit({
                supplierId,
                number,
                notes: mergedNotes || undefined,
                lines: lines.map((l, i) => ({
                  lineNo: i + 1,
                  skuCode: l.skuCode || undefined,
                  description: l.description || `Line ${i + 1}`,
                  qtyOrdered: l.qtyOrdered,
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
      <div className="w-full max-w-md bg-cosmos-surface border-l border-cosmos-border p-6">
        <h2 className="text-lg font-semibold text-cosmos-white">New supplier</h2>
        <input
          placeholder="Code"
          className="mt-4 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <input
          placeholder="Name"
          className="mt-2 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Email"
          className="mt-2 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="Phone (optional)"
          className="mt-2 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {props.error && <p className="text-red-400 text-xs mt-2">{props.error.message}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-md border border-cosmos-border text-sm text-cosmos-text"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={props.loading || !code || !name}
            className="flex-1 h-10 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
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
