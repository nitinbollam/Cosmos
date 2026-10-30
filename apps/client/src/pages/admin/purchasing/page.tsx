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
  { label: 'PENDING_APPROVAL', value: 'PENDING_APPROVAL' },
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
                description={statusFilter ? 'Try clearing the status filter.' : 'Purchase orders are created from approved purchase requisitions.'}
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
