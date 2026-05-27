import { useQuery } from '@tanstack/react-query'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'

type Order = {
  id: string
  totalAmount: string | number
  amountPaid?: string | number | null
  status: string
  createdAt: string
}

export default function PaymentReceivedReportPage() {
  const orders = useQuery({
    queryKey: ['report-payments'],
    queryFn: () => api.get<{ items: Order[] }>('/orders?page=1&pageSize=200'),
  })

  const paid = (orders.data?.items ?? []).filter((o) => Number(o.amountPaid ?? 0) > 0)
  const totalReceived = paid.reduce((s, o) => s + Number(o.amountPaid ?? 0), 0)

  return (
    <AdminPageShell title="Payment Received Report" section="Reports" description="Payments recorded against sales orders.">
      <div className="rounded-xl p-4 mb-6 max-w-sm" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
        <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>Total received (sample)</p>
        <p className="text-2xl font-bold" style={{ color: 'var(--c-heading)' }}>${totalReceived.toFixed(2)}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>{paid.length} orders with payments</p>
      </div>
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--c-border-card)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'var(--c-surface-2)' }}>
            <tr>
              <th className="text-left p-3">Order</th>
              <th className="text-right p-3">Order total</th>
              <th className="text-right p-3">Paid</th>
              <th className="text-right p-3">Balance</th>
            </tr>
          </thead>
          <tbody>
            {paid.map((o) => {
              const total = Number(o.totalAmount)
              const paidAmt = Number(o.amountPaid ?? 0)
              return (
                <tr key={o.id} style={{ borderTop: '1px solid var(--c-border-card)' }}>
                  <td className="p-3 font-mono text-xs">{o.id.slice(0, 12)}…</td>
                  <td className="p-3 text-right">${total.toFixed(2)}</td>
                  <td className="p-3 text-right">${paidAmt.toFixed(2)}</td>
                  <td className="p-3 text-right">${Math.max(0, total - paidAmt).toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </AdminPageShell>
  )
}
