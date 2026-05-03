'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

type LineItem = {
  id: string
  skuId: string
  warehouseId?: string
  quantity: number
  unitPrice: string | number
}

type OrderDetail = {
  id: string
  tenantId?: string
  customerId: string
  status: string
  totalAmount: string | number
  createdAt: string
  cancelledAt?: string | null
  failureReason?: string | null
  lineItems?: LineItem[]
}

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''

  const { data, isLoading, error } = useQuery<OrderDetail>({
    queryKey: ['order', id],
    queryFn: () => api.get(`/orders/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  })

  return (
    <div className="p-6 space-y-4">
      <Link href="/orders" className="text-xs text-cosmos-muted hover:text-cosmos-text">
        ← Orders
      </Link>
      <h1 className="text-2xl font-bold text-cosmos-white">Order detail</h1>
      {!id ? <p className="text-cosmos-muted text-sm">Missing order id.</p> : null}
      {error ? (
        <p className="text-red-400 text-sm">
          {(error as Error)?.message ?? 'Unable to load order — check auth'}
        </p>
      ) : null}
      {isLoading ? <p className="text-cosmos-muted text-sm">Loading…</p> : null}
      {!isLoading && data ? (
        <Card>
          <CardTitle className="font-mono text-sm">{data.id}</CardTitle>
          <div className="mt-3 space-y-1 text-sm text-cosmos-muted">
            <div>
              <span className="text-cosmos-text">Status:</span>{' '}
              <strong className="text-cosmos-white">{data.status}</strong>
            </div>
            <div>
              Customer <span className="font-mono text-xs">{data.customerId}</span>
            </div>
            <div>
              Total <span className="text-cosmos-white">${Number(data.totalAmount).toFixed(2)}</span>
            </div>
            <div>Created {new Date(data.createdAt).toLocaleString()}</div>
            {data.cancelledAt ? <div className="text-amber-300">Cancelled {new Date(data.cancelledAt).toLocaleString()}</div> : null}
            {data.failureReason ? <div className="text-red-300">Reason: {data.failureReason}</div> : null}
          </div>
          {Array.isArray(data.lineItems) && data.lineItems.length > 0 ? (
            <>
              <h2 className="text-sm font-medium text-cosmos-white mt-5 mb-2">Line items</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                      <th className="pb-2 pr-3 font-medium">SKU</th>
                      <th className="pb-2 pr-3 font-medium">Warehouse</th>
                      <th className="pb-2 pr-3 font-medium">Qty</th>
                      <th className="pb-2 font-medium">Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lineItems.map((li) => (
                      <tr key={li.id} className="border-b border-cosmos-border/60">
                        <td className="py-2 pr-3 font-mono text-xs text-cosmos-text">{li.skuId}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{li.warehouseId ?? '—'}</td>
                        <td className="py-2 pr-3">{li.quantity}</td>
                        <td className="py-2 text-cosmos-white">${Number(li.unitPrice).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-xs text-cosmos-muted mt-4">No line items returned for this record.</p>
          )}
        </Card>
      ) : null}
    </div>
  )
}
