import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'

type OrderRow = {
  id: string
  customerId: string
  channel: string
  status: string
  totalAmount: string | number
  taxAmount?: string | number
  createdAt: string
  shippingAddress?: unknown
  lineItems?: { id: string }[]
}

type ListResp = {
  items: OrderRow[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

const STATUS_TABS = [
  'ALL',
  'PENDING',
  'CONFIRMED',
  'FULFILLED',
  'SHIPPED',
  'DELIVERED',
  'FAILED',
  'CANCELLED',
] as const

const CHANNELS = ['ALL', 'B2B_PORTAL', 'POS', 'SALES_REP', 'API'] as const

function customerLabel(o: OrderRow): string {
  const addr = o.shippingAddress
  if (addr && typeof addr === 'object' && addr !== null) {
    const a = addr as Record<string, unknown>
    if (typeof a.company === 'string' && a.company.trim()) return a.company
    if (typeof a.line1 === 'string' && a.line1.trim()) return a.line1
  }
  return `Customer …${o.customerId.slice(-6)}`
}

function lineItemCount(o: OrderRow): number {
  return o.lineItems?.length ?? 0
}

export default function OrdersPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusTab, setStatusTab] = useState<string>('ALL')
  const [channel, setChannel] = useState<string>('ALL')
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const [cancelId, setCancelId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('Cancelled from admin')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    setPage(1)
  }, [statusTab, channel, debouncedSearch, fromDate, toDate])

  const listQ = useQuery({
    queryKey: ['orders', 'admin', page, statusTab, channel, debouncedSearch, fromDate, toDate],
    queryFn: async () => {
      const q = new URLSearchParams()
      q.set('page', String(page))
      q.set('pageSize', '20')
      if (statusTab !== 'ALL') q.set('status', statusTab)
      if (channel !== 'ALL') q.set('channel', channel)
      if (debouncedSearch) q.set('search', debouncedSearch)
      if (fromDate) q.set('from', fromDate)
      if (toDate) q.set('to', toDate)
      return api.get<ListResp>(`/orders?${q.toString()}`)
    },
  })

  const cancelMut = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await api.post(`/orders/${encodeURIComponent(id)}/cancel`, { reason })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['orders'] })
      setCancelId(null)
    },
  })

  const rows = listQ.data?.items ?? []

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white" style={{ fontFamily: 'var(--font-display)' }}>
            Orders
          </h1>
          <p className="text-cosmos-text-3 text-sm mt-1">Tenant-scoped order pipeline</p>
        </div>
        <button type="button" className="btn-ghost !text-sm" onClick={() => void listQ.refetch()}>
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusTab(s)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
            style={{
              background: statusTab === s ? 'var(--c-accent-soft)' : 'var(--c-surface-2)',
              color: statusTab === s ? 'var(--c-accent)' : 'var(--c-text-2)',
              border: `1px solid ${statusTab === s ? 'var(--c-accent)' : 'var(--c-border-card)'}`,
            }}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="cosmos-card flex flex-wrap gap-4 items-end">
        <div className="min-w-[200px] flex-1">
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-cosmos-text-3">Search</label>
          <input
            className="cosmos-input"
            placeholder="Order # or customer id"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-cosmos-text-3">Channel</label>
          <select className="cosmos-input w-[180px]" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-cosmos-text-3">From</label>
          <input type="date" className="cosmos-input w-[160px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-1 text-cosmos-text-3">To</label>
          <input type="date" className="cosmos-input w-[160px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

      <div className="cosmos-card overflow-x-auto">
        {listQ.isLoading ? (
          <div className="py-8 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-11 w-full" />
            ))}
          </div>
        ) : listQ.isError ? (
          <p className="text-sm py-8" style={{ color: 'var(--c-danger)' }}>
            {(listQ.error as Error)?.message ?? 'Failed to load orders'}
          </p>
        ) : rows.length === 0 ? (
          <EmptyState icon="🛒" title="No orders" description="Try changing filters or date range." />
        ) : (
          <>
            <table className="cosmos-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Customer</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono text-sm">
                      <Link to={`/orders/${encodeURIComponent(o.id)}`} className="text-cosmos-accent hover:underline">
                        #{o.id.slice(-10)}
                      </Link>
                    </td>
                    <td className="max-w-[200px] truncate text-sm">{customerLabel(o)}</td>
                    <td>
                      <span className="text-xs font-mono text-cosmos-text-2">{o.channel}</span>
                    </td>
                    <td>
                      <StatusBadge status={o.status} />
                    </td>
                    <td>{lineItemCount(o)}</td>
                    <td className="font-mono">${Number(o.totalAmount).toFixed(2)}</td>
                    <td className="text-sm text-cosmos-text-3">{new Date(o.createdAt).toLocaleString()}</td>
                    <td className="whitespace-nowrap">
                      <Link to={`/orders/${encodeURIComponent(o.id)}`} className="btn-ghost !py-1 !px-2 !text-xs mr-1 inline-block">
                        View
                      </Link>
                      {(o.status === 'PENDING' || o.status === 'CONFIRMED') && (
                        <button
                          type="button"
                          className="btn-ghost !py-1 !px-2 !text-xs"
                          style={{ color: 'var(--c-danger)', borderColor: 'var(--c-danger)' }}
                          onClick={() => {
                            setCancelId(o.id)
                            setCancelReason('Cancelled from admin')
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between mt-4 pt-4" style={{ borderTop: '1px solid var(--c-border)' }}>
              <p className="text-sm text-cosmos-text-3">
                Page {listQ.data?.page ?? page} · {(listQ.data?.total ?? 0).toLocaleString()} orders
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost !py-2 !text-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-ghost !py-2 !text-sm"
                  disabled={!listQ.data?.hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {cancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={() => setCancelId(null)}>
          <div className="cosmos-card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-3">Cancel order</h3>
            <p className="text-sm text-cosmos-text-3 font-mono mb-2">#{cancelId.slice(-10)}</p>
            <label className="text-xs text-cosmos-text-3">Reason (required)</label>
            <input className="cosmos-input mb-4" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setCancelId(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: 'var(--c-danger)' }}
                disabled={!cancelReason.trim() || cancelMut.isPending}
                onClick={() => cancelMut.mutate({ id: cancelId, reason: cancelReason.trim() })}
              >
                Cancel order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
