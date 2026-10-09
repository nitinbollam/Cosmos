import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'

type GiftCard = {
  id: string
  code: string
  initialBalance: string | number
  currentBalance: string | number
  issuedToCustomerId?: string | null
  createdAt: string
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default function GiftCardsPage() {
  const qc = useQueryClient()
  const [amount, setAmount] = useState('50')
  const [customerId, setCustomerId] = useState('')
  const [lookupCode, setLookupCode] = useState('')
  const [newCode, setNewCode] = useState<string | null>(null)

  const listQ = useQuery<GiftCard[]>({
    queryKey: ['gift-cards'],
    queryFn: () => api.get('/gift-cards'),
  })

  const detailQ = useQuery<{ card: GiftCard; transactions: Array<{ type: string; amount: string | number; createdAt: string }> }>({
    queryKey: ['gift-card-detail', lookupCode],
    queryFn: () => api.get(`/gift-cards/${encodeURIComponent(lookupCode)}`),
    enabled: lookupCode.trim().length >= 8,
  })

  const issue = useMutation({
    mutationFn: () =>
      api.post<{ code: string }>('/gift-cards', {
        amount: Number(amount),
        issuedToCustomerId: customerId.trim() || undefined,
      }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['gift-cards'] })
      setNewCode(res.code)
      setAmount('50')
      setCustomerId('')
    },
  })

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white">Gift cards</h1>
        <p className="text-pleros-muted text-sm mt-1">Issue stored-value cards with ledger liability tracking.</p>
      </div>

      <Card>
        <CardTitle>Issue gift card</CardTitle>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2 max-w-xl"
          onSubmit={(e) => {
            e.preventDefault()
            setNewCode(null)
            issue.mutate()
          }}
        >
          <div>
            <label className="text-xs text-pleros-text-3">Amount ($)</label>
            <input className="pleros-input mt-1 w-full" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs text-pleros-text-3">Customer ID (optional)</label>
            <input className="pleros-input mt-1 w-full" value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="For email delivery" />
          </div>
          {issue.isError ? (
            <p className="sm:col-span-2 text-xs text-red-400">
              {issue.error instanceof Error ? issue.error.message : 'Failed to issue gift card'}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary" disabled={issue.isPending}>
              {issue.isPending ? 'Issuing…' : 'Issue card'}
            </button>
          </div>
        </form>

        {newCode ? (
          <div className="mt-4 p-4 rounded border border-emerald-500/30 bg-emerald-500/10 space-y-2">
            <p className="text-xs text-emerald-400 font-semibold">✓ Gift card created</p>
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg text-emerald-300 font-bold select-all bg-black/40 px-3 py-1.5 rounded border border-emerald-500/30">
                {newCode}
              </span>
              <button
                type="button"
                className="btn-ghost !text-xs"
                onClick={() => void navigator.clipboard.writeText(newCode)}
              >
                Copy code
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Lookup by code</CardTitle>
        <input
          className="pleros-input mt-3 w-full max-w-md uppercase"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={lookupCode}
          onChange={(e) => setLookupCode(e.target.value.toUpperCase())}
        />
        {detailQ.data ? (
          <div className="mt-4 text-sm space-y-2">
            <p>Balance: {money(Number(detailQ.data.card.currentBalance))}</p>
            <ul className="text-pleros-text-3">
              {detailQ.data.transactions.map((t) => (
                <li key={`${t.type}-${t.createdAt}`}>
                  {t.type} · {money(Number(t.amount))} · {new Date(t.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Recent cards</CardTitle>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-pleros-muted border-b border-pleros-border">
                <th className="pb-2 pr-4">Code</th>
                <th className="pb-2 pr-4">Balance</th>
                <th className="pb-2">Issued</th>
              </tr>
            </thead>
            <tbody>
              {(listQ.data ?? []).map((c) => (
                <tr key={c.id} className="border-b border-pleros-border/60">
                  <td className="py-2 pr-4 font-mono">{c.code}</td>
                  <td className="py-2 pr-4">{money(Number(c.currentBalance))}</td>
                  <td className="py-2 text-pleros-muted">{new Date(c.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
