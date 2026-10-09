import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'

type OrderRow = {
  id: string
  customerId: string
  status: string
  totalAmount: string | number
  createdAt: string
  lineItems?: { id: string }[]
  shippingAddress?: { company?: string; line1?: string } | null
}

type ListResp = {
  items: OrderRow[]
  total: number
}

function customerLabel(o: OrderRow): string {
  const addr = o.shippingAddress
  if (addr && typeof addr === 'object' && 'company' in addr && addr.company) {
    return String(addr.company)
  }
  if (o.customerId.startsWith('cust_')) {
    const clean = o.customerId.replace('cust_', '').replace(/_/g, ' ')
    return clean.charAt(0).toUpperCase() + clean.slice(1)
  }
  return `Customer #${o.customerId.slice(-6).toUpperCase()}`
}

function formatOrderNumber(id: string): string {
  if (!id) return ''
  if (id.startsWith('seed_ord_')) {
    return `ORD-${id.replace('seed_ord_', '').toUpperCase()}`
  }
  return `ORD-${id.slice(-6).toUpperCase()}`
}

export function RecentOrders() {
  const { data, isLoading, isError, error, refetch } = useQuery<ListResp>({
    queryKey: ['orders', 'recent'],
    queryFn: () => api.get(`/orders?page=1&pageSize=10`),
    refetchInterval: 30_000,
  })

  const rows = data?.items ?? []

  return (
    <div className="pleros-card">
      <div className="flex items-center justify-between gap-4">
        <CardTitle>Recent orders</CardTitle>
        <button type="button" className="btn-ghost !py-1.5 !px-3 !text-xs" onClick={() => void refetch()}>
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="mt-4 text-sm" style={{ color: 'var(--c-danger)' }}>
          {error instanceof Error ? error.message : 'Failed to load orders'}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🛒"
          title="No orders yet"
          description="New orders will appear here as customers place them."
        />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="font-mono text-sm font-semibold" style={{ color: 'var(--c-primary)' }}>
                    #{formatOrderNumber(o.id)}
                  </td>
                  <td className="font-medium">{customerLabel(o)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="font-mono font-medium">${Number(o.totalAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="text-sm" style={{ color: 'var(--c-text-3)' }}>
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <Link to={adminPath(`/orders/${encodeURIComponent(o.id)}`)} className="btn-ghost !py-1.5 !px-3 !text-xs">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
