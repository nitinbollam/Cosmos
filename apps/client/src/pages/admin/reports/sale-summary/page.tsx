import { useQuery } from '@tanstack/react-query'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'

type Order = { id: string; status: string; channel: string; totalAmount: string | number; createdAt: string }

export default function SaleSummaryReportPage() {
  const orders = useQuery({
    queryKey: ['report-sale-summary'],
    queryFn: () => api.get<{ items: Order[]; total: number }>('/orders?page=1&pageSize=200'),
  })

  const items = orders.data?.items ?? []
  const revenue = items.reduce((s, o) => s + Number(o.totalAmount), 0)
  const byChannel = items.reduce<Record<string, number>>((acc, o) => {
    acc[o.channel] = (acc[o.channel] ?? 0) + Number(o.totalAmount)
    return acc
  }, {})

  return (
    <AdminPageShell title="Sale Summary Report" section="Reports" description="Revenue and order volume from sales orders.">
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>Total revenue</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--c-heading)' }}>${revenue.toFixed(2)}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>Orders</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--c-heading)' }}>{orders.data?.total ?? items.length}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
          <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>Avg order</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--c-heading)' }}>${items.length ? (revenue / items.length).toFixed(2) : '0.00'}</p>
        </div>
      </div>
      <h2 className="font-semibold mb-2" style={{ color: 'var(--c-on-dark)' }}>By channel</h2>
      <ul className="space-y-2 mb-6">
        {Object.entries(byChannel).map(([ch, amt]) => (
          <li key={ch} className="flex justify-between rounded-lg px-3 py-2" style={{ background: 'var(--c-surface-2)' }}>
            <span>{ch}</span>
            <span className="font-medium">${amt.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--c-border-card)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--c-surface-2)' }}>
            <tr>
              <th className="text-left p-3">Order</th>
              <th className="text-left p-3">Channel</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 50).map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid var(--c-border-card)' }}>
                <td className="p-3 font-mono text-xs">{o.id.slice(0, 12)}…</td>
                <td className="p-3">{o.channel}</td>
                <td className="p-3">{o.status}</td>
                <td className="p-3 text-right">${Number(o.totalAmount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminPageShell>
  )
}
