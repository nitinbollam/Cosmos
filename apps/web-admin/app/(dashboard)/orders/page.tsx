'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

type OrderRow = {
  id: string
  customerId: string
  status: string
  totalAmount: string | number
  createdAt: string
}

type ListResp = {
  items: OrderRow[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export default function OrdersPage() {
  const [page, setPage] = useState(1)

  const { data, isLoading, refetch } = useQuery<ListResp>({
    queryKey: ['orders', 'admin', page],
    queryFn: () => api.get(`/orders?page=${page}&pageSize=15`),
  })

  const rows = data?.items ?? []
  const statusColors: Record<string, string> = useMemo(
    () => ({
      CONFIRMED: 'text-emerald-400',
      PENDING: 'text-amber-400',
      FAILED: 'text-red-400',
      CANCELLED: 'text-slate-500',
      PROCESSING: 'text-sky-400',
      SHIPPED: 'text-teal-300',
    }),
    [],
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white">Orders</h1>
          <p className="text-cosmos-muted text-sm mt-1">
            Live tenant-scoped catalog from{' '}
            <span className="font-mono">order-service</span> via gateway.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="h-9 px-3 rounded-md border border-cosmos-border text-xs text-cosmos-text hover:bg-cosmos-surface-2"
        >
          Refresh
        </button>
      </div>

      <Card>
        <CardTitle>Orders</CardTitle>
        {isLoading ? (
          <p className="text-cosmos-muted text-sm mt-3">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-cosmos-muted text-sm mt-3">No orders in this tenant yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                  <th className="pb-2 pr-4 font-medium">ID</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Total</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-b border-cosmos-border/60">
                    <td className="py-2 pr-4 font-mono text-xs text-cosmos-text">
                      <Link
                        href={`/orders/${encodeURIComponent(o.id)}`}
                        className="text-cosmos-text hover:text-cosmos-white underline decoration-cosmos-border"
                      >
                        {o.id.slice(-12)}…
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-cosmos-muted font-mono text-xs">{o.customerId.slice(-10)}…</td>
                    <td className={`py-2 pr-4 ${statusColors[o.status] ?? 'text-cosmos-text'}`}>{o.status}</td>
                    <td className="py-2 pr-4 text-cosmos-white">${Number(o.totalAmount).toFixed(2)}</td>
                    <td className="py-2 text-cosmos-muted text-xs">
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-cosmos-muted">
                Page {data?.page ?? page} · {data?.total ?? rows.length} total
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  className="h-8 px-2 rounded-md border border-cosmos-border text-xs disabled:opacity-40"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={!(data?.hasMore)}
                  className="h-8 px-2 rounded-md border border-cosmos-border text-xs disabled:opacity-40"
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
