import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'

type SavedSearch = { id: string; query: string | null; category: string | null; notifyEmail: boolean }

export default function MarketplaceAlertsPage() {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')

  const catsQ = useQuery({
    queryKey: ['marketplace', 'categories'],
    queryFn: () => api.get<string[]>('/marketplace/categories'),
  })

  const searchesQ = useQuery({
    queryKey: ['marketplace', 'saved-searches'],
    queryFn: () => api.get<SavedSearch[]>('/marketplace/saved-searches'),
  })

  const createMut = useMutation({
    mutationFn: () =>
      api.post('/marketplace/saved-searches', {
        query: query.trim() || undefined,
        category: category.trim() || undefined,
      }),
    onSuccess: () => {
      setQuery('')
      void qc.invalidateQueries({ queryKey: ['marketplace', 'saved-searches'] })
    },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/marketplace/saved-searches/${encodeURIComponent(id)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['marketplace', 'saved-searches'] }),
  })

  return (
    <div>
      <Link to="/admin/marketplace" className="text-sm text-pleros-accent">
        ← Marketplace
      </Link>
      <h1 className="text-2xl font-display text-pleros-white mt-2">Saved searches</h1>
      <p className="text-sm text-pleros-text-3 mt-1">Get email alerts when new listings match.</p>

      <div className="mt-4 max-w-md space-y-3">
        <input className="pleros-input w-full" placeholder="Keyword" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="pleros-input w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any category</option>
          {(catsQ.data ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="button" className="btn-primary text-sm" disabled={createMut.isPending} onClick={() => void createMut.mutate()}>
          Save alert
        </button>
        {createMut.error && <p className="text-sm text-red-400">{axiosErr(createMut.error)}</p>}
      </div>

      <ul className="mt-6 space-y-2">
        {(searchesQ.data ?? []).map((s) => (
          <li key={s.id} className="text-sm flex justify-between gap-3">
            <span>
              {s.query ?? '—'} · {s.category ?? 'any category'}
            </span>
            <button type="button" className="text-red-400 text-xs" onClick={() => void delMut.mutate(s.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
