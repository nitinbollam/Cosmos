import { useQuery } from '@tanstack/react-query'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'

type Snapshot = { date: string; revenue: string | number; ordersCount: number; skusActive?: number }

export default function DailySummaryReportPage() {
  const kpis = useQuery({ queryKey: ['analytics-kpis'], queryFn: () => api.get<{ todayRevenue: number; openOrders: number }>('/analytics/kpis') })
  const snapshots = useQuery({ queryKey: ['kpi-snapshots'], queryFn: () => api.get<Snapshot[]>('/kpi/snapshots') })

  return (
    <AdminPageShell title="Daily Summary Report" section="Reports" description="Daily KPI snapshots synced from orders.">
      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <div className="rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>Today revenue</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--c-heading)' }}>${(kpis.data?.todayRevenue ?? 0).toFixed(2)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>Open orders</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--c-heading)' }}>{kpis.data?.openOrders ?? 0}</p>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--c-border-card)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--c-surface-2)' }}>
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-right p-3">Orders</th>
              <th className="text-right p-3">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {(snapshots.data ?? []).slice(0, 30).map((row) => (
              <tr key={row.date} style={{ borderTop: '1px solid var(--c-border-card)' }}>
                <td className="p-3">{String(row.date).slice(0, 10)}</td>
                <td className="p-3 text-right">{row.ordersCount}</td>
                <td className="p-3 text-right">${Number(row.revenue).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPageShell>
  )
}
