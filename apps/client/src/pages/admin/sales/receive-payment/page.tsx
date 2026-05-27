import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'
import { errMsg } from '@/hooks/use-tenant-metadata'

type Order = {
  id: string
  status: string
  totalAmount: string | number
  amountPaid?: string | number | null
}

export default function ReceivePaymentPage() {
  const [orderId, setOrderId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [ok, setOk] = useState(false)

  const orders = useQuery({
    queryKey: ['orders-payment'],
    queryFn: () => api.get<{ items: Order[] }>('/orders?page=1&pageSize=100').then((r) => r.items),
  })

  const selected = orders.data?.find((o) => o.id === orderId)
  const remaining = selected
    ? Math.max(0, Number(selected.totalAmount) - Number(selected.amountPaid ?? 0))
    : 0

  const pay = useMutation({
    mutationFn: () =>
      api.post(`/orders/${orderId}/payments`, {
        amount: Number(amount),
        method,
        reference: reference || undefined,
      }),
    onSuccess: () => setOk(true),
  })

  return (
    <AdminPageShell title="Receive Payment" section="Sales" description="Record payment against an open sales order.">
      <form className="max-w-md space-y-3 rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }} onSubmit={(e) => { e.preventDefault(); setOk(false); pay.mutate() }}>
        <select className="cosmos-input w-full" value={orderId} onChange={(e) => { setOrderId(e.target.value); setOk(false) }} required>
          <option value="">Select order</option>
          {orders.data?.map((o) => {
            const due = Math.max(0, Number(o.totalAmount) - Number(o.amountPaid ?? 0))
            return (
              <option key={o.id} value={o.id} disabled={due <= 0}>
                {o.id.slice(0, 10)}… · due ${due.toFixed(2)}
              </option>
            )
          })}
        </select>
        {selected ? <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>Balance due: ${remaining.toFixed(2)}</p> : null}
        <input className="cosmos-input w-full" type="number" min={0.01} step="0.01" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <select className="cosmos-input w-full" value={method} onChange={(e) => setMethod(e.target.value)}>
          {['CASH', 'CHECK', 'ACH', 'CARD', 'WIRE'].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input className="cosmos-input w-full" placeholder="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <button type="submit" className="btn-primary" disabled={pay.isPending || !orderId}>Record payment</button>
        <Link to="/admin/sales/orders" className="text-sm block" style={{ color: 'var(--c-accent)' }}>View sale orders →</Link>
      </form>
      {ok ? <p className="text-sm mt-3" style={{ color: 'var(--c-success)' }}>Payment recorded.</p> : null}
      {pay.error ? <p className="text-sm mt-3" style={{ color: 'var(--c-danger)' }}>{errMsg(pay.error)}</p> : null}
    </AdminPageShell>
  )
}
