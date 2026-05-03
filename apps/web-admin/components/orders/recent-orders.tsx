'use client'
import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

interface OrderItem {
  id: string
  customerId: string
  status: string
  totalAmount: number
  createdAt: string
}

export function RecentOrders() {
  const { data, isLoading } = useQuery<{ items: OrderItem[] }>({
    queryKey: ['orders', 'recent'],
    queryFn: () => api.get('/orders?page=1&pageSize=10'),
    refetchInterval: 30_000,
  })
  return (
    <Card>
      <CardTitle>Recent orders</CardTitle>
      {isLoading ? (
        <div className="text-cosmos-muted text-sm mt-2">Loading…</div>
      ) : (
        <ul className="mt-3 divide-y divide-cosmos-border">
          {(data?.items ?? []).map((o) => (
            <li key={o.id} className="py-2 flex justify-between text-sm">
              <span className="text-cosmos-text font-mono">#{o.id.slice(-6)}</span>
              <span className="text-cosmos-muted">{o.status}</span>
              <span className="text-cosmos-white">${Number(o.totalAmount).toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
