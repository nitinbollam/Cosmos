import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/cosmos/status-badge'

type LineItem = {
  id: string
  skuId: string
  warehouseId?: string
  quantity: number
  unitPrice: string | number
  taxAmount?: string | number
}

type Saga = {
  id: string
  status: string
  correlationId: string
  completedSteps: string[]
  failureReason?: string | null
  updatedAt: string
  createdAt: string
}

type OrderDetail = {
  id: string
  tenantId?: string
  customerId: string
  channel: string
  status: string
  totalAmount: string | number
  taxAmount?: string | number
  paymentMethod: string
  paymentIntentId?: string | null
  createdAt: string
  confirmedAt?: string | null
  cancelledAt?: string | null
  failureReason?: string | null
  shippingAddress?: Record<string, unknown> | null
  lineItems?: LineItem[]
  saga?: Saga | null
}

type CustomerResp = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
}

type WmsTask = {
  id: string
  status: string
  orderId: string
  warehouseCode: string
  pickItems: { id: string; quantity: number; pickedQty: number; status: string }[]
}

function formatAddress(addr: Record<string, unknown> | null | undefined): string[] {
  if (!addr) return []
  const parts: string[] = []
  const company = addr.company
  if (typeof company === 'string' && company) parts.push(company)
  const line1 = addr.line1
  if (typeof line1 === 'string' && line1) parts.push(line1)
  const line2 = addr.line2
  if (typeof line2 === 'string' && line2) parts.push(line2)
  const city = addr.city
  const state = addr.state
  const zip = addr.postalCode ?? addr.zip
  const cityLine = [city, state, zip].filter((x) => typeof x === 'string' && x).join(', ')
  if (cityLine) parts.push(cityLine)
  return parts
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ? decodeURIComponent(params.id) : ''
  const qc = useQueryClient()

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('Cancelled from admin')

  const orderQ = useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<OrderDetail>(`/orders/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  })

  const customerQ = useQuery({
    queryKey: ['customers', orderQ.data?.customerId],
    queryFn: async () => {
      try {
        return await api.get<CustomerResp>(`/customers/${encodeURIComponent(orderQ.data!.customerId)}`)
      } catch {
        return null
      }
    },
    enabled: Boolean(orderQ.data?.customerId),
  })

  const tasksQ = useQuery({
    queryKey: ['wms', 'tasks', 'order', id],
    queryFn: () => api.get<WmsTask[]>(`/wms/tasks?orderId=${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  })

  const confirmMut = useMutation({
    mutationFn: () => api.post(`/orders/${encodeURIComponent(id)}/confirm`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order', id] })
      void qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  const cancelMut = useMutation({
    mutationFn: () => api.post(`/orders/${encodeURIComponent(id)}/cancel`, { reason: cancelReason.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order', id] })
      void qc.invalidateQueries({ queryKey: ['orders'] })
      setCancelOpen(false)
    },
  })

  const fulfillMut = useMutation({
    mutationFn: async () => {
      const o = orderQ.data
      if (!o?.lineItems?.length) throw new Error('No line items')
      const correlationId =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `corr-${Date.now()}`
      await api.post('/fulfillment/tasks', {
        orderId: o.id,
        correlationId,
        lineItems: o.lineItems.map((li) => ({
          skuId: li.skuId,
          warehouseId: li.warehouseId ?? '',
          quantity: li.quantity,
        })),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'tasks', 'order', id] })
      void qc.invalidateQueries({ queryKey: ['order', id] })
    },
  })

  const data = orderQ.data
  const subtotal =
    data?.lineItems?.reduce((s, li) => s + li.quantity * Number(li.unitPrice), 0) ?? Number(data?.totalAmount ?? 0)
  const tax = Number(data?.taxAmount ?? 0)
  const task = tasksQ.data?.[0]

  const picked =
    task?.pickItems?.filter((p) => p.pickedQty >= p.quantity || p.status === 'PICKED' || p.status === 'SHORT').length ?? 0
  const pickTotal = task?.pickItems?.length ?? 0
  const pickPct = pickTotal > 0 ? Math.round((picked / pickTotal) * 100) : 0

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <Link to="/orders" className="text-sm text-cosmos-accent hover:underline">
        ← Orders
      </Link>

      {orderQ.isLoading ? (
        <div className="space-y-2 mt-4">
          <div className="skeleton h-10 w-2/3" />
          <div className="skeleton h-32 w-full" />
        </div>
      ) : orderQ.isError || !data ? (
        <p className="text-red-400 mt-4">{(orderQ.error as Error)?.message ?? 'Order not found'}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-cosmos-white font-display font-mono tracking-tight">#{data.id.slice(-12)}</h1>
              <div className="flex flex-wrap gap-3 mt-3 items-center">
                <StatusBadge status={data.status} />
                <span
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}
                >
                  {data.channel.replace(/_/g, ' ')}
                </span>
                <span className="text-sm text-cosmos-text-3">Created {new Date(data.createdAt).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {data.status === 'PENDING' && (
                <button type="button" className="btn-primary !text-sm" disabled={confirmMut.isPending} onClick={() => confirmMut.mutate()}>
                  Confirm
                </button>
              )}
              {(data.status === 'PENDING' || data.status === 'CONFIRMED') && (
                <button
                  type="button"
                  className="btn-ghost !text-sm"
                  style={{ borderColor: 'var(--c-danger)', color: 'var(--c-danger)' }}
                  onClick={() => setCancelOpen(true)}
                >
                  Cancel
                </button>
              )}
              {data.status === 'CONFIRMED' && !task && (
                <button type="button" className="btn-primary !text-sm" disabled={fulfillMut.isPending} onClick={() => fulfillMut.mutate()}>
                  Create shipment
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="cosmos-card">
              <h3 className="text-cosmos-white font-semibold font-display mb-3">Customer</h3>
              {customerQ.data ? (
                <div className="text-sm space-y-1" style={{ color: 'var(--c-text-2)' }}>
                  <p className="text-cosmos-white font-medium">{customerQ.data.name}</p>
                  {customerQ.data.email && <p>{customerQ.data.email}</p>}
                  {customerQ.data.phone && <p>{customerQ.data.phone}</p>}
                  <p className="font-mono text-xs text-cosmos-text-3">ID {data.customerId.slice(-12)}</p>
                </div>
              ) : customerQ.isLoading ? (
                <p className="text-sm text-cosmos-text-3">Loading customer…</p>
              ) : (
                <p className="text-sm text-cosmos-text-3 font-mono">{data.customerId}</p>
              )}
              {formatAddress(data.shippingAddress ?? undefined).length > 0 && (
                <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--c-border)' }}>
                  <p className="text-[11px] uppercase tracking-wider text-cosmos-text-3 mb-1">Ship to</p>
                  {formatAddress(data.shippingAddress ?? undefined).map((line) => (
                    <p key={line} className="text-sm text-cosmos-text">
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className="cosmos-card">
              <h3 className="text-cosmos-white font-semibold font-display mb-3">Payment</h3>
              <dl className="text-sm space-y-2">
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-text-3">Method</dt>
                  <dd className="font-mono">{data.paymentMethod}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-text-3">Intent</dt>
                  <dd className="font-mono text-xs truncate max-w-[200px]">{data.paymentIntentId ?? '—'}</dd>
                </div>
              </dl>
              {data.paymentIntentId && (
                <a
                  to={`https://dashboard.stripe.com/payments/${encodeURIComponent(data.paymentIntentId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-3 text-sm text-cosmos-accent hover:underline"
                >
                  Open in Stripe →
                </a>
              )}
            </div>
          </div>

          <div className="cosmos-card overflow-x-auto">
            <h3 className="text-cosmos-white font-semibold font-display mb-3">Line items</h3>
            <table className="cosmos-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(data.lineItems ?? []).map((li) => {
                  const lt = li.quantity * Number(li.unitPrice)
                  return (
                    <tr key={li.id}>
                      <td className="font-mono text-xs">{li.skuId.slice(-14)}</td>
                      <td>{li.quantity}</td>
                      <td className="font-mono">${Number(li.unitPrice).toFixed(2)}</td>
                      <td className="font-mono">${lt.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="mt-4 text-right text-sm space-y-1 max-w-xs ml-auto">
              <div className="flex justify-between gap-6 text-cosmos-text-2">
                <span>Subtotal</span>
                <span className="font-mono">${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-6 text-cosmos-text-2">
                <span>Tax</span>
                <span className="font-mono">${tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-6 text-cosmos-white font-semibold pt-2 border-t" style={{ borderColor: 'var(--c-border)' }}>
                <span>Total</span>
                <span className="font-mono">${Number(data.totalAmount).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {task && (
            <div className="cosmos-card">
              <h3 className="text-cosmos-white font-semibold font-display mb-3">Fulfillment</h3>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <StatusBadge status={task.status} />
                <span className="text-sm text-cosmos-text-2">{task.warehouseCode}</span>
                <Link to={`/fulfillment/${encodeURIComponent(task.id)}`} className="text-sm text-cosmos-accent hover:underline">
                  Open pick task →
                </Link>
              </div>
              <p className="text-xs text-cosmos-text-3 mb-1">
                Pick progress: {picked}/{pickTotal}
              </p>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-surface-2)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pickPct}%`, background: 'var(--c-primary)' }} />
              </div>
            </div>
          )}

          {data.saga && (
            <div className="cosmos-card">
              <h3 className="text-cosmos-white font-semibold font-display mb-3">Saga timeline</h3>
              <p className="text-sm mb-2">
                Orchestration <span className="font-mono text-cosmos-text-2">{data.saga.status}</span> · updated{' '}
                {new Date(data.saga.updatedAt).toLocaleString()}
              </p>
              {data.saga.failureReason && <p className="text-sm text-red-400 mb-2">{data.saga.failureReason}</p>}
              <ol className="list-decimal list-inside space-y-1 text-sm text-cosmos-text-2">
                {(data.saga.completedSteps ?? []).length === 0 ? (
                  <li className="list-none text-cosmos-text-3">No completed steps recorded yet.</li>
                ) : (
                  data.saga.completedSteps.map((step) => (
                    <li key={step} className="font-mono text-xs">
                      {step}
                    </li>
                  ))
                )}
              </ol>
            </div>
          )}
        </>
      )}

      {cancelOpen && data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setCancelOpen(false)}
        >
          <div className="cosmos-card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-3">Cancel order</h3>
            <label className="text-xs text-cosmos-text-3">Reason</label>
            <input className="cosmos-input mb-4" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setCancelOpen(false)}>
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: 'var(--c-danger)' }}
                disabled={!cancelReason.trim() || cancelMut.isPending}
                onClick={() => cancelMut.mutate()}
              >
                Cancel order
              </button>
            </div>
          </div>
        </div>
      )}

      {fulfillMut.isError && (
        <div className="cosmos-card border text-sm" style={{ borderColor: 'var(--c-warning)', color: 'var(--c-warning)' }}>
          {(fulfillMut.error as Error)?.message ??
            'Could not create fulfillment — task may already exist or WMS unavailable.'}
        </div>
      )}
    </div>
  )
}
