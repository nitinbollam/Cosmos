import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'
import { errMsg } from '@/hooks/use-tenant-metadata'

type Order = { id: string; status: string; totalAmount: string | number; customerId: string }

export default function SalesReturnsPage() {
  const [orderId, setOrderId] = useState('')
  const [reason, setReason] = useState('Customer return')
  const [ok, setOk] = useState(false)

  const orders = useQuery({
    queryKey: ['orders-returns'],
    queryFn: () => api.get<{ items: Order[] }>('/orders?page=1&pageSize=100').then((r) => r.items),
  })

  const cancel = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/cancel`, { reason }),
    onSuccess: () => setOk(true),
  })

  return (
    <AdminPageShell title="Sales Return" section="Sales" description="Cancel a delivered or open order to process a customer return.">
      <form className="max-w-md space-y-3 rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }} onSubmit={(e) => { e.preventDefault(); setOk(false); cancel.mutate() }}>
        <select className="cosmos-input w-full" value={orderId} onChange={(e) => setOrderId(e.target.value)} required>
          <option value="">Select order</option>
          {orders.data?.map((o) => (
            <option key={o.id} value={o.id}>{o.id.slice(0, 12)}… · {o.status} · ${Number(o.totalAmount).toFixed(2)}</option>
          ))}
        </select>
        <input className="cosmos-input w-full" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" className="btn-primary" disabled={cancel.isPending}>Process return</button>
      </form>
      {ok ? <p className="text-sm mt-3" style={{ color: 'var(--c-success)' }}>Order cancelled as sales return.</p> : null}
      {cancel.error ? <p className="text-sm mt-3" style={{ color: 'var(--c-danger)' }}>{errMsg(cancel.error)}</p> : null}
    </AdminPageShell>
  )
}
