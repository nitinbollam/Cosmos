import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { hasClientPermission } from '@/lib/requisitions'
import { useViewer } from '@/components/purchasing/use-viewer'
import { formatAmount } from '@/lib/decimal-amount'
import { supplierFormErrors } from '@/lib/supplier-form'

type PoStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'SUBMITTED' | 'PARTIALLY_RECEIVED' | 'CLOSED' | 'CANCELLED'

type PurchaseOrder = {
  id: string
  number: string
  status: PoStatus
  notes?: string | null
  createdAt: string
  /** Set when the PO was converted from an approved requisition. */
  requisitionId?: string | null
  supplier?: { id: string; name: string; code: string }
  lines?: Array<{ id: string; lineNo: number; description: string; qtyOrdered: number; skuCode?: string | null }>
  currency?: string
  warehouseId?: string | null
  warehouse?: { id: string; name: string; code: string } | null
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
  const [supplierDrawer, setSupplierDrawer] = useState(false)
  const navigate = useNavigate()
  const { viewer, loading: viewerLoading } = useViewer()
  // POs are only created by converting an approved requisition, so the purchase entry point is New requisition.
  const canRequisition = hasClientPermission(viewer, 'requisitions.write')
  const reorderWithoutAccess = !!prefillSkuId && !viewerLoading && !canRequisition

  useEffect(() => {
    // Low-stock links (and old bookmarks) start a requisition for that SKU.
    if (!prefillSkuId || viewerLoading || !canRequisition) return
    navigate(adminPath(`/purchasing/requisitions/new?skuId=${encodeURIComponent(prefillSkuId)}`), { replace: true })
  }, [prefillSkuId, viewerLoading, canRequisition, navigate])

  const [warehouseFilter, setWarehouseFilter] = useState('')
  const warehouseOptions = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses'),
    enabled: tab === 'pos',
  })

  const posQuery = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', statusFilter, warehouseFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (warehouseFilter) params.set('warehouseId', warehouseFilter)
      const qs = params.toString()
      return api.get(qs ? `/purchase-orders?${qs}` : '/purchase-orders')
    },
    enabled: tab === 'pos',
    refetchInterval: 5000,
  })

  const suppliers = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
    enabled: tab === 'suppliers',
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
          {reorderWithoutAccess && (
            <p role="status" className="rounded-md border border-pleros-border p-3 text-sm text-pleros-muted">
              Reorders start as a purchase requisition, which a manager approves before it becomes a PO. Ask an admin for
              requisition access, or ask a manager to raise it.
            </p>
          )}
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
            <select
              aria-label="Filter by destination warehouse"
              className="h-8 rounded-md bg-pleros-surface-2 border border-pleros-border px-2 text-xs text-pleros-text"
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
            >
              <option value="">All warehouses</option>
              {(warehouseOptions.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <div className="ml-auto flex flex-wrap gap-2">
              {canRequisition && (
                <Link to={adminPath('/purchasing/requisitions')} className="h-9 px-4 rounded-md border border-pleros-border text-pleros-text text-sm inline-flex items-center">
                  Requisitions
                </Link>
              )}
              {canRequisition && (
                <Link to={adminPath('/purchasing/requisitions/new')} className="h-9 px-4 rounded-md bg-pleros-primary text-white text-sm inline-flex items-center">
                  New requisition
                </Link>
              )}
            </div>
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
                description={statusFilter || warehouseFilter ? 'Try clearing the filters.' : 'Purchase orders are created from approved purchase requisitions.'}
                action={
                  canRequisition ? (
                    <Link to={adminPath('/purchasing/requisitions/new')} className="h-9 px-4 rounded-md bg-pleros-primary text-white text-sm inline-flex items-center">
                      New requisition
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-pleros-muted border-b border-pleros-border">
                      <th className="pb-2 pr-4">PO #</th>
                      <th className="pb-2 pr-4">Supplier</th>
                      <th className="pb-2 pr-4">Warehouse</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4 text-right">Total</th>
                      <th className="pb-2 pr-4">Created</th>
                      <th className="pb-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(posQuery.data ?? []).map((po) => (
                      <tr key={po.id} className="border-b border-pleros-border/60">
                        <td className="py-2 pr-4 font-mono text-pleros-white">
                          {po.number}
                          {po.requisitionId ? <span className="block font-sans text-xs text-pleros-muted">From a requisition</span> : null}
                        </td>
                        <td className="py-2 pr-4 text-pleros-text">{po.supplier?.name ?? '—'}</td>
                        <td className="py-2 pr-4 text-pleros-text">{po.warehouse?.name ?? '—'}</td>
                        <td className="py-2 pr-4">
                          <StatusBadge status={po.status} />
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-pleros-white">
                          {po.total != null ? formatAmount(po.total, po.currency ?? 'USD', { grouping: false }) : '—'}
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
  const fieldErrors = showProblems ? supplierFormErrors({ code, name, email }) : { code: '', name: '', email: '' }
  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-md bg-pleros-surface border-l border-pleros-border p-6">
        <h2 className="text-lg font-semibold text-pleros-white">New supplier</h2>
        <label htmlFor="supplier-code" className="mt-4 block text-xs text-pleros-muted">Supplier code</label>
        <input
          id="supplier-code"
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={Boolean(fieldErrors.code)}
          aria-describedby={fieldErrors.code ? 'supplier-code-error' : undefined}
        />
        {fieldErrors.code && <p id="supplier-code-error" className="mt-1 text-xs text-red-400">{fieldErrors.code}</p>}
        <label htmlFor="supplier-name" className="mt-3 block text-xs text-pleros-muted">Supplier name</label>
        <input
          id="supplier-name"
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
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
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'supplier-email-error' : undefined}
        />
        {fieldErrors.email && <p id="supplier-email-error" className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>}
        <label htmlFor="supplier-phone" className="mt-3 block text-xs text-pleros-muted">Phone (optional)</label>
        <input
          id="supplier-phone"
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        {props.error && <p role="alert" className="text-red-400 text-xs mt-2">Could not create supplier: {props.error.message}</p>}
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
              if (Object.values(supplierFormErrors({ code, name, email })).some(Boolean)) return
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
