import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-admin'

type SearchResult = {
  orders: Array<{ id: string; status: string; totalAmount: number }>
  customers: Array<{ id: string; name: string; email: string | null }>
  skus: Array<{ id: string; code: string; name: string }>
  quotes: Array<{ id: string; status: string }>
}

export function GlobalSearch() {
  const [q, setQ] = useState('')
  const [term, setTerm] = useState('')

  const { data } = useQuery({
    queryKey: ['search', term],
    queryFn: () => api.get<SearchResult>(`/search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
  })

  return (
    <div className="relative hidden md:block">
      <input
        className="pleros-input text-sm w-56 lg:w-72"
        placeholder="Search orders, SKUs, customers…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setTerm(q.trim())
        }}
      />
      {term.length >= 2 && data ? (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border p-3 shadow-lg"
          style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
        >
          {data.orders.slice(0, 3).map((o) => (
            <Link key={o.id} to={`/admin/orders/${o.id}`} className="block py-1 text-sm hover:underline">
              Order {o.id.slice(-8)} · {o.status}
            </Link>
          ))}
          {data.skus.slice(0, 3).map((s) => (
            <Link key={s.id} to={`/admin/inventory/${s.id}`} className="block py-1 text-sm hover:underline">
              SKU {s.code} · {s.name}
            </Link>
          ))}
          {data.customers.slice(0, 3).map((c) => (
            <Link key={c.id} to={`/admin/crm/customers/${c.id}`} className="block py-1 text-sm hover:underline">
              {c.name}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}
