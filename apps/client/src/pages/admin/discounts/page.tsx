import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { axiosErr } from '@/lib/axios-error'

type Discount = {
  id: string
  code: string | null
  type: 'PERCENTAGE' | 'FIXED_AMOUNT'
  scope: 'ORDER' | 'LINE_ITEM'
  amount: string | number
  minPurchase?: string | number | null
  usageLimit?: number | null
  perCustomerLimit?: number | null
  timesUsed: number
  isActive: boolean
  startsAt?: string | null
  expiresAt?: string | null
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function DiscountsPage() {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE')
  const [amount, setAmount] = useState('10')
  const [minPurchase, setMinPurchase] = useState('')
  const [usageLimit, setUsageLimit] = useState('')

  const q = useQuery<Discount[]>({
    queryKey: ['discounts'],
    queryFn: () => api.get('/discounts'),
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/discounts', {
        code: code.trim().toUpperCase(),
        type,
        scope: 'ORDER',
        amount: Number(amount),
        minPurchase: minPurchase.trim() ? Number(minPurchase) : null,
        usageLimit: usageLimit.trim() ? Number(usageLimit) : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['discounts'] })
      setCode('')
      setAmount('10')
      setMinPurchase('')
      setUsageLimit('')
    },
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => api.post(`/discounts/${encodeURIComponent(id)}/deactivate`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['discounts'] }),
  })

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white">Discounts & coupons</h1>
        <p className="text-pleros-muted text-sm mt-1">
          Promo codes for storefront checkout and POS. High discounts may require manager approval per workflow settings.
        </p>
      </div>

      <Card>
        <CardTitle>Create discount</CardTitle>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2 max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          <div>
            <label className="text-xs text-pleros-text-3">Code</label>
            <input className="pleros-input mt-1 w-full uppercase" value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs text-pleros-text-3">Type</label>
            <select className="pleros-input mt-1 w-full" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED_AMOUNT">Fixed amount</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-pleros-text-3">{type === 'PERCENTAGE' ? 'Percent off' : 'Amount off ($)'}</label>
            <input className="pleros-input mt-1 w-full" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs text-pleros-text-3">Min purchase ($)</label>
            <input className="pleros-input mt-1 w-full" type="number" min={0} step="0.01" value={minPurchase} onChange={(e) => setMinPurchase(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className="text-xs text-pleros-text-3">Total usage limit</label>
            <input className="pleros-input mt-1 w-full" type="number" min={1} value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} placeholder="Unlimited" />
          </div>
          {create.isError ? (
            <p className="sm:col-span-2 text-xs text-red-400 mt-1">{axiosErr(create.error)}</p>
          ) : null}
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={create.isPending || !code.trim()}>
              {create.isPending ? 'Creating…' : 'Create discount'}
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <CardTitle>Active discounts</CardTitle>
        {q.isLoading ? (
          <p className="text-sm text-pleros-muted mt-3">Loading…</p>
        ) : (q.data?.length ?? 0) === 0 ? (
          <div className="mt-2">
            <EmptyState icon="🏷️" title="No discounts yet" description="Create a code above to get started." />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-pleros-muted border-b border-pleros-border">
                  <th className="pb-2 pr-4">Code</th>
                  <th className="pb-2 pr-4">Value</th>
                  <th className="pb-2 pr-4">Used</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((d) => (
                  <tr key={d.id} className="border-b border-pleros-border/60">
                    <td className="py-2 pr-4 font-mono">{d.code ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {d.type === 'PERCENTAGE' ? `${Number(d.amount)}%` : money(Number(d.amount))}
                      {d.minPurchase ? ` · min ${money(Number(d.minPurchase))}` : ''}
                    </td>
                    <td className="py-2 pr-4">
                      {d.timesUsed}
                      {d.usageLimit != null ? ` / ${d.usageLimit}` : ''}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={d.isActive ? 'ACTIVE' : 'INACTIVE'} />
                    </td>
                    <td className="py-2">
                      {d.isActive ? (
                        <button
                          type="button"
                          className="btn-ghost !text-xs !py-1"
                          disabled={deactivate.isPending}
                          onClick={() => deactivate.mutate(d.id)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
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
