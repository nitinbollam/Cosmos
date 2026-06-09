import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/cosmos/status-badge'

type LineItem = {
  id: string
  skuId: string
  warehouseId?: string
  quantity: number
  quantityAllocated?: number
  quantityBackordered?: number
  fulfillmentType?: string
  supplierId?: string | null
  dropShipPoId?: string | null
  returnedQty?: number
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

type ShipmentRow = {
  id: string
  shipmentNo: number
  status: string
  carrier?: string | null
  trackingNumber?: string | null
  shippedAt?: string | null
  lineItems: Array<{ skuId: string; warehouseId: string; quantity: number }>
}

type ShipmentDraft = {
  carrier: string
  trackingNumber: string
  qtyByLineId: Record<string, number>
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
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('Customer return')
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({})

  const [shipEditorOpen, setShipEditorOpen] = useState(false)
  const [shipDrafts, setShipDrafts] = useState<ShipmentDraft[]>([])
  const [shipErr, setShipErr] = useState<string | null>(null)
  const [dropShipTracking, setDropShipTracking] = useState('')
  const [dropShipCarrier, setDropShipCarrier] = useState('Vendor')

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

  const shipmentsQ = useQuery({
    queryKey: ['order-shipments', id],
    queryFn: () => api.get<ShipmentRow[]>(`/orders/${encodeURIComponent(id)}/shipments`),
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
    mutationFn: () => api.post(`/orders/${encodeURIComponent(id)}/fulfill`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wms', 'tasks', 'order', id] })
      void qc.invalidateQueries({ queryKey: ['order', id] })
    },
  })

  const dropShipMut = useMutation({
    mutationFn: () =>
      api.post(`/orders/${encodeURIComponent(id)}/drop-ship/ship`, {
        carrier: dropShipCarrier.trim() || 'Vendor',
        trackingNumber: dropShipTracking.trim() || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order', id] })
      void qc.invalidateQueries({ queryKey: ['order-shipments', id] })
    },
  })

  const invoiceQ = useQuery({
    queryKey: ['order-invoice', id],
    queryFn: () => api.get<{ invoiceNumber: string; id: string; displayStatus: string }>(`/orders/${encodeURIComponent(id)}/invoice`),
    enabled: Boolean(id) && ['SHIPPED', 'DELIVERED', 'RETURNED'].includes(orderQ.data?.status ?? ''),
    retry: false,
  })

  const returnMut = useMutation({
    mutationFn: () => {
      const lines = Object.entries(returnQtys)
        .filter(([, qty]) => qty > 0)
        .map(([lineItemId, quantity]) => ({ lineItemId, quantity }))
      return api.post(`/orders/${encodeURIComponent(id)}/returns`, {
        reason: returnReason.trim() || undefined,
        lines,
        restock: true,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order', id] })
      void qc.invalidateQueries({ queryKey: ['order-invoice', id] })
      void qc.invalidateQueries({ queryKey: ['finance', 'invoices-ar'] })
      setReturnOpen(false)
      setReturnQtys({})
    },
  })

  const saveShipmentsMut = useMutation({
    mutationFn: (payload: {
      shipments: Array<{
        carrier?: string
        trackingNumber?: string
        lineItems: Array<{ skuId: string; warehouseId: string; quantity: number }>
      }>
    }) => api.post(`/orders/${encodeURIComponent(id)}/shipments`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['order-shipments', id] })
      setShipEditorOpen(false)
      setShipErr(null)
    },
    onError: (e: Error) => setShipErr(e.message),
  })

  const data = orderQ.data

  function openShipEditor() {
    if (!data?.lineItems?.length) return
    const existing = shipmentsQ.data ?? []
    if (existing.length > 0) {
      setShipDrafts(
        existing.map((s) => {
          const qtyByLineId: Record<string, number> = {}
          for (const li of data.lineItems ?? []) {
            const match = (s.lineItems ?? []).find(
              (x) => x.skuId === li.skuId && x.warehouseId === (li.warehouseId ?? ''),
            )
            qtyByLineId[li.id] = match?.quantity ?? 0
          }
          return {
            carrier: s.carrier ?? '',
            trackingNumber: s.trackingNumber ?? '',
            qtyByLineId,
          }
        }),
      )
    } else {
      setShipDrafts([
        {
          carrier: '',
          trackingNumber: '',
          qtyByLineId: Object.fromEntries((data.lineItems ?? []).map((li) => [li.id, li.quantity])),
        },
      ])
    }
    setShipErr(null)
    setShipEditorOpen(true)
  }

  function saveShipments() {
    if (!data?.lineItems?.length) return
    for (const li of data.lineItems) {
      const sum = shipDrafts.reduce((s, d) => s + (d.qtyByLineId[li.id] ?? 0), 0)
      if (sum !== li.quantity) {
        setShipErr(`Line ${li.skuId.slice(-8)} must total ${li.quantity} units across shipments (got ${sum}).`)
        return
      }
    }
    const shipments = shipDrafts
      .map((d) => ({
        carrier: d.carrier.trim() || undefined,
        trackingNumber: d.trackingNumber.trim() || undefined,
        lineItems: (data.lineItems ?? [])
          .filter((li) => (d.qtyByLineId[li.id] ?? 0) > 0)
          .map((li) => ({
            skuId: li.skuId,
            warehouseId: li.warehouseId ?? '',
            quantity: d.qtyByLineId[li.id] ?? 0,
          })),
      }))
      .filter((s) => s.lineItems.length > 0)
    if (shipments.length === 0) {
      setShipErr('Add at least one shipment with quantities.')
      return
    }
    saveShipmentsMut.mutate({ shipments })
  }

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
      <Link to={adminPath('/orders')} className="text-sm text-cosmos-accent hover:underline">
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
                  Confirm & fulfill
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
              {(data.status === 'CONFIRMED' || data.status === 'PROCESSING') && !task && (
                <button type="button" className="btn-primary !text-sm" disabled={fulfillMut.isPending} onClick={() => fulfillMut.mutate()}>
                  Start fulfillment
                </button>
              )}
              {['PACKED', 'SHIPPED', 'DELIVERED', 'PROCESSING'].includes(data.status) ? (
                <button type="button" className="btn-ghost !text-sm" onClick={openShipEditor}>
                  {(shipmentsQ.data?.length ?? 0) > 0 ? 'Edit shipments' : 'Split shipments'}
                </button>
              ) : null}
              {['SHIPPED', 'DELIVERED'].includes(data.status) && (
                <button type="button" className="btn-ghost !text-sm" onClick={() => {
                  const init: Record<string, number> = {}
                  for (const li of data.lineItems ?? []) {
                    const remaining = li.quantity - (li.returnedQty ?? 0)
                    if (remaining > 0) init[li.id] = remaining
                  }
                  setReturnQtys(init)
                  setReturnOpen(true)
                }}>
                  Process return
                </button>
              )}
            </div>
          </div>

          {invoiceQ.data && (
            <div className="cosmos-card flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-cosmos-text-3 uppercase tracking-wider">Invoice</p>
                <p className="font-mono text-cosmos-white">{invoiceQ.data.invoiceNumber}</p>
              </div>
              <StatusBadge status={invoiceQ.data.displayStatus} />
            </div>
          )}

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
                  href={`https://dashboard.stripe.com/payments/${encodeURIComponent(data.paymentIntentId)}`}
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
                  <th>Allocated</th>
                  <th>Backordered</th>
                  <th>Fulfillment</th>
                  <th>Returned</th>
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
                      <td>{li.quantityAllocated ?? 0}</td>
                      <td>{li.quantityBackordered ?? 0}</td>
                      <td className="text-xs">
                        {li.fulfillmentType === 'DROP_SHIP' ? (
                          <span>
                            Drop-ship
                            {li.dropShipPoId ? ` · PO ${li.dropShipPoId.slice(-8)}` : ''}
                          </span>
                        ) : (
                          'Stock'
                        )}
                      </td>
                      <td>{li.returnedQty ?? 0}</td>
                      <td className="font-mono">${Number(li.unitPrice).toFixed(2)}</td>
                      <td className="font-mono">${lt.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {(data.lineItems ?? []).some((li) => li.fulfillmentType === 'DROP_SHIP') &&
            !['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(data.status) ? (
              <div className="mt-4 p-4 rounded-lg flex flex-wrap gap-3 items-end" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
                <div>
                  <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>
                    Carrier
                  </div>
                  <input className="cosmos-input" value={dropShipCarrier} onChange={(e) => setDropShipCarrier(e.target.value)} />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>
                    Tracking
                  </div>
                  <input className="cosmos-input" value={dropShipTracking} onChange={(e) => setDropShipTracking(e.target.value)} placeholder="Optional" />
                </div>
                <button type="button" className="btn-primary" disabled={dropShipMut.isPending} onClick={() => dropShipMut.mutate()}>
                  Mark drop-ship shipped
                </button>
              </div>
            ) : null}
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
                <Link to={adminPath(`/fulfillment/${encodeURIComponent(task.id)}`)} className="text-sm text-cosmos-accent hover:underline">
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

          {(shipmentsQ.data?.length ?? 0) > 0 ? (
            <div className="cosmos-card">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h3 className="text-cosmos-white font-semibold font-display">Shipments</h3>
                <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={openShipEditor}>
                  Edit
                </button>
              </div>
              <ul className="space-y-3">
                {(shipmentsQ.data ?? []).map((s) => (
                  <li
                    key={s.id}
                    className="rounded-lg p-3 border text-sm"
                    style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono">Shipment #{s.shipmentNo}</span>
                      <StatusBadge status={s.status} />
                    </div>
                    <p className="text-cosmos-text-3 mt-1">
                      {s.carrier ?? 'Carrier TBD'}
                      {s.trackingNumber ? ` · ${s.trackingNumber}` : ''}
                    </p>
                    <p className="text-xs text-cosmos-text-3 mt-1">
                      {(s.lineItems ?? []).map((li) => `${li.quantity}× ${li.skuId.slice(-8)}`).join(' · ')}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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

      {returnOpen && data && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setReturnOpen(false)}
        >
          <div className="cosmos-card max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-3">Process return (RMA)</h3>
            <p className="text-xs text-cosmos-text-3 mb-4">Restocks inventory and issues a credit memo against the invoice.</p>
            <label className="text-xs text-cosmos-text-3">Reason</label>
            <input className="cosmos-input mb-4" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
            <ul className="space-y-3">
              {(data.lineItems ?? []).map((li) => {
                const remaining = li.quantity - (li.returnedQty ?? 0)
                if (remaining <= 0) return null
                return (
                  <li key={li.id} className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs flex-1 truncate">{li.skuId.slice(-12)}</span>
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      className="cosmos-input w-20"
                      value={returnQtys[li.id] ?? 0}
                      onChange={(e) =>
                        setReturnQtys((prev) => ({
                          ...prev,
                          [li.id]: Math.min(remaining, Math.max(0, Number(e.target.value) || 0)),
                        }))
                      }
                    />
                    <span className="text-cosmos-text-3 text-xs">/ {remaining}</span>
                  </li>
                )
              })}
            </ul>
            {returnMut.isError && (
              <p className="text-red-400 text-sm mt-3">{(returnMut.error as Error)?.message ?? 'Return failed'}</p>
            )}
            <div className="flex gap-2 justify-end mt-6">
              <button type="button" className="btn-ghost" onClick={() => setReturnOpen(false)}>
                Back
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={returnMut.isPending || !Object.values(returnQtys).some((q) => q > 0)}
                onClick={() => returnMut.mutate()}
              >
                {returnMut.isPending ? 'Processing…' : 'Submit return'}
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

      {shipEditorOpen && data ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setShipEditorOpen(false)}
        >
          <div className="cosmos-card max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-2">Split shipments</h3>
            <p className="text-xs text-cosmos-text-3 mb-4">
              Allocate line quantities across shipments. Totals must match the order exactly.
            </p>
            <div className="space-y-4">
              {shipDrafts.map((draft, idx) => (
                <div key={idx} className="rounded-lg p-4 border" style={{ borderColor: 'var(--c-border)' }}>
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-semibold text-cosmos-white">Shipment {idx + 1}</span>
                    {shipDrafts.length > 1 ? (
                      <button
                        type="button"
                        className="btn-ghost !py-1 !px-2 !text-xs"
                        onClick={() => setShipDrafts((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-cosmos-text-3">Carrier</label>
                      <input
                        className="cosmos-input mt-1"
                        placeholder="UPS, FedEx…"
                        value={draft.carrier}
                        onChange={(e) =>
                          setShipDrafts((prev) =>
                            prev.map((d, i) => (i === idx ? { ...d, carrier: e.target.value } : d)),
                          )
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs text-cosmos-text-3">Tracking #</label>
                      <input
                        className="cosmos-input mt-1 font-mono"
                        value={draft.trackingNumber}
                        onChange={(e) =>
                          setShipDrafts((prev) =>
                            prev.map((d, i) => (i === idx ? { ...d, trackingNumber: e.target.value } : d)),
                          )
                        }
                      />
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {(data.lineItems ?? []).map((li) => (
                      <li key={li.id} className="flex items-center gap-3 text-sm">
                        <span className="font-mono text-xs flex-1 truncate">{li.skuId.slice(-12)}</span>
                        <input
                          type="number"
                          min={0}
                          max={li.quantity}
                          className="cosmos-input w-20"
                          value={draft.qtyByLineId[li.id] ?? 0}
                          onChange={(e) => {
                            const v = Math.min(li.quantity, Math.max(0, Number(e.target.value) || 0))
                            setShipDrafts((prev) =>
                              prev.map((d, i) =>
                                i === idx ? { ...d, qtyByLineId: { ...d.qtyByLineId, [li.id]: v } } : d,
                              ),
                            )
                          }}
                        />
                        <span className="text-cosmos-text-3 text-xs">/ {li.quantity}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn-ghost !text-sm mt-4"
              onClick={() => {
                if (!data.lineItems?.length) return
                setShipDrafts((prev) => [
                  ...prev,
                  {
                    carrier: '',
                    trackingNumber: '',
                    qtyByLineId: Object.fromEntries(data.lineItems!.map((li) => [li.id, 0])),
                  },
                ])
              }}
            >
              + Add shipment
            </button>
            {shipErr ? <p className="text-red-400 text-sm mt-3">{shipErr}</p> : null}
            <div className="flex gap-2 justify-end mt-6">
              <button type="button" className="btn-ghost" onClick={() => setShipEditorOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={saveShipmentsMut.isPending} onClick={saveShipments}>
                {saveShipmentsMut.isPending ? 'Saving…' : 'Save shipments'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
