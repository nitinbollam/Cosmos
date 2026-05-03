'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

type FloorTask = {
  id: string
  orderId: string
  status: string
  priority: string
  warehouseCode: string
  pickItems?: { id: string; skuId: string; quantity: number; pickedQty: number; status: string }[]
}

export default function FulfillmentTasksPage() {
  const tasks = useQuery<FloorTask[]>({
    queryKey: ['wms', 'tasks', 'floor'],
    queryFn: () => api.get('/wms/tasks'),
    refetchInterval: 45_000,
  })

  const rows = tasks.data ?? []

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white">Fulfillment</h1>
          <p className="text-cosmos-muted text-sm mt-1">
            Floor tasks from <span className="font-mono">wms-service</span> (<code>/wms/tasks</code>). Open a row to{' '}
            <strong className="text-cosmos-text">pack</strong> or <strong className="text-cosmos-text">dispatch</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void tasks.refetch()}
          className="h-9 px-3 rounded-md border border-cosmos-border text-xs text-cosmos-text hover:bg-cosmos-surface-2"
        >
          Refresh
        </button>
      </div>

      <Card>
        <CardTitle>Pick tasks</CardTitle>
        {tasks.isLoading ? (
          <p className="text-cosmos-muted text-sm mt-3">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-cosmos-muted text-sm mt-3">
            No PENDING/PICKING tasks. Saga-created tasks appear once orders flow through WMS.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                  <th className="pb-2 pr-4 font-medium">Task</th>
                  <th className="pb-2 pr-4 font-medium">Order</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">WH</th>
                  <th className="pb-2 font-medium">Lines</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-cosmos-border/60 hover:bg-cosmos-surface-2/40">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/fulfillment/${encodeURIComponent(t.id)}`}
                        className="font-mono text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2"
                      >
                        {t.id.slice(0, 10)}…
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-cosmos-muted">{t.orderId.slice(0, 12)}…</td>
                    <td className="py-2 pr-4 text-cosmos-white">{t.status}</td>
                    <td className="py-2 pr-4 text-cosmos-muted text-xs">{t.warehouseCode}</td>
                    <td className="py-2 text-cosmos-muted text-xs">{t.pickItems?.length ?? '—'}</td>
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
