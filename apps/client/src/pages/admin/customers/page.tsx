import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { useState } from 'react'

type Customer = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
}

export default function CustomersPage() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const { data, isLoading } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers'),
  })

  const create = useMutation({
    mutationFn: () =>
      api.post('/customers', {
        name,
        email: email || undefined,
      }),
    onSuccess: () => {
      setName('')
      setEmail('')
      void qc.invalidateQueries({ queryKey: ['customers'] })
    },
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-cosmos-white">Customers</h1>
        <p className="text-cosmos-muted text-sm mt-1">
          Tenant-scoped records from <span className="font-mono">crm-service</span>.
        </p>
      </div>

      <Card>
        <CardTitle>Add customer</CardTitle>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 bg-cosmos-surface-2 border border-cosmos-border rounded-md px-3 h-10 text-sm text-cosmos-white"
            placeholder="Company / account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="flex-1 bg-cosmos-surface-2 border border-cosmos-border rounded-md px-3 h-10 text-sm text-cosmos-white"
            placeholder="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="button"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="h-10 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
          >
            {create.isPending ? 'Saving…' : 'Create'}
          </button>
        </div>
        {create.error && (
          <p className="text-red-400 text-xs mt-2">{String((create.error as Error).message)}</p>
        )}
      </Card>

      <Card>
        <CardTitle>Directory</CardTitle>
        {isLoading ? (
          <p className="text-cosmos-muted text-sm mt-3">Loading…</p>
        ) : (
          <ul className="mt-4 divide-y divide-cosmos-border">
            {(data ?? []).map((c) => (
              <li key={c.id} className="py-3 flex justify-between gap-4">
                <div>
                  <Link
                    to={adminPath(`/crm/customers/${c.id}`)}
                    className="text-cosmos-white font-medium hover:text-cosmos-primary"
                  >
                    {c.name}
                  </Link>
                  <div className="text-xs text-cosmos-muted font-mono">{c.id.slice(-14)}…</div>
                </div>
                <div className="text-right text-sm text-cosmos-muted">
                  {c.email ?? '—'}
                  {c.phone ? <div>{c.phone}</div> : null}
                </div>
              </li>
            ))}
            {!data?.length && <li className="text-cosmos-muted text-sm py-4">No customers yet.</li>}
          </ul>
        )}
      </Card>
    </div>
  )
}
