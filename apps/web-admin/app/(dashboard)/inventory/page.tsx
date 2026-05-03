'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

type SkuRow = {
  id: string
  code: string
  name: string
  category: string
  price: string | number
  quantityOnHand?: number
}

type SkuPage = {
  items: SkuRow[]
  total?: number
  page?: number
  pageSize?: number
}

type AlertRow = { skuId: string; name: string; available: number }

export default function InventoryPage() {
  const skus = useQuery<SkuPage>({
    queryKey: ['skus'],
    queryFn: () => api.get(`/skus?page=1&pageSize=40`),
  })
  const alerts = useQuery<{ lowStock: AlertRow[] }>({
    queryKey: ['inventory', 'alerts'],
    queryFn: () => api.get('/inventory/alerts'),
    refetchInterval: 120_000,
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cosmos-white">Inventory</h1>
        <p className="text-cosmos-muted text-sm mt-1">SKUs plus low-stock watchlist.</p>
      </div>

      <Card>
        <CardTitle>Low stock</CardTitle>
        <ul className="mt-3 divide-y divide-cosmos-border space-y-0">
          {(alerts.data?.lowStock ?? []).slice(0, 12).map((a) => (
            <li key={a.skuId} className="flex justify-between py-2 text-sm">
              <span className="text-cosmos-text">{a.name}</span>
              <span className="text-amber-400 font-mono">{a.available}</span>
            </li>
          ))}
          {!alerts.isLoading &&
            !(alerts.data?.lowStock?.length) && (
              <li className="text-cosmos-muted text-sm py-2">Nothing under reorder threshold.</li>
            )}
        </ul>
      </Card>

      <Card>
        <CardTitle>Catalog (SKUs)</CardTitle>
        {skus.isLoading ? (
          <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                  <th className="pb-2 pr-4">Code</th>
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Category</th>
                  <th className="pb-2">Price</th>
                </tr>
              </thead>
              <tbody>
                {(skus.data?.items ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-cosmos-border/60">
                    <td className="py-2 pr-4 font-mono text-xs text-cosmos-accent">{s.code}</td>
                    <td className="py-2 pr-4 text-cosmos-text">{s.name}</td>
                    <td className="py-2 pr-4 text-cosmos-muted">{s.category}</td>
                    <td className="py-2 text-cosmos-white">${Number(s.price).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
