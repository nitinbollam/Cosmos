'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

type Snap = {
  id: string
  date: string
  ordersCount: number
  revenue: string | number
  skusActive: number
}

type Journal = {
  id: string
  description: string
  isPosted: boolean
  postedAt: string
}

export default function FinancePage() {
  const snaps = useQuery<Snap[]>({
    queryKey: ['finance', 'kpi'],
    queryFn: () => api.get('/kpi/snapshots'),
    refetchInterval: 180_000,
  })

  const journals = useQuery<Journal[]>({
    queryKey: ['finance', 'journals'],
    queryFn: () => api.get('/journal-entries'),
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cosmos-white">Finance</h1>
        <p className="text-cosmos-muted text-sm mt-1">KPI history + ledger journal backlog.</p>
      </div>

      <Card>
        <CardTitle>Daily KPI snapshots</CardTitle>
        {snaps.isLoading ? (
          <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Orders</th>
                  <th className="pb-2 pr-4">Revenue</th>
                  <th className="pb-2">Active SKUs</th>
                </tr>
              </thead>
              <tbody>
                {(snaps.data ?? []).slice(0, 31).map((s) => (
                  <tr key={s.id} className="border-b border-cosmos-border/60">
                    <td className="py-2 pr-4 text-cosmos-text">
                      {new Date(s.date).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-4 font-mono text-cosmos-muted">{s.ordersCount}</td>
                    <td className="py-2 pr-4 text-cosmos-white">${Number(s.revenue).toFixed(2)}</td>
                    <td className="py-2 text-cosmos-muted">{s.skusActive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Journal entries</CardTitle>
        {journals.isLoading ? (
          <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                  <th className="pb-2 pr-4">ID</th>
                  <th className="pb-2 pr-4">Memo</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Posted</th>
                </tr>
              </thead>
              <tbody>
                {(journals.data ?? []).slice(0, 40).map((j) => (
                  <tr key={j.id} className="border-b border-cosmos-border/60">
                    <td className="py-2 pr-4 font-mono text-xs text-cosmos-text">{j.id.slice(-12)}…</td>
                    <td className="py-2 pr-4 text-cosmos-muted max-w-[220px] truncate">{j.description}</td>
                    <td className="py-2 pr-4">{j.isPosted ? 'POSTED' : 'DRAFT'}</td>
                    <td className="py-2 text-xs text-cosmos-muted">
                      {new Date(j.postedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!journals.data?.length && (
              <p className="text-cosmos-muted text-sm py-4">No journal drafts yet.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
