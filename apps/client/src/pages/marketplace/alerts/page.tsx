import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'
import { EmptyState } from '@/components/pleros/empty-state'
import { MarketplaceNav } from '../marketplace-nav'

type SavedSearch = {
  id: string
  query: string | null
  category: string | null
  notifyEmail: boolean
}

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
      setCategory('')
      void qc.invalidateQueries({ queryKey: ['marketplace', 'saved-searches'] })
    },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/marketplace/saved-searches/${encodeURIComponent(id)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['marketplace', 'saved-searches'] }),
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <MarketplaceNav
        title="Saved Alerts"
        subtitle="Receive instant notifications whenever wholesale lots or surplus SKUs matching your criteria are listed."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Create Alert Form (Left 1 col) */}
        <div className="space-y-4">
          <div
            className="rounded-2xl border p-6 space-y-4 shadow-xl sticky top-6"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div>
              <h2 className="text-base font-semibold text-pleros-white">Create Search Alert</h2>
              <p className="text-xs text-pleros-text-3 mt-0.5">We’ll alert you when matches are published</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-1.5">
                  Target Keyword
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-pleros-text-3">
                    🔍
                  </span>
                  <input
                    className="pleros-input w-full !pl-8 !py-2.5 !text-sm"
                    placeholder="e.g. Copper Pipe, SKU-1002, Pallet…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-pleros-text-3 mb-1.5">
                  Product Category
                </label>
                <select
                  className="pleros-input w-full !py-2.5 !text-sm"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Any category</option>
                  {(catsQ.data ?? []).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                className="btn-primary w-full !py-2.5 !text-sm font-semibold inline-flex items-center justify-center gap-2 mt-2"
                disabled={(!query.trim() && !category) || createMut.isPending}
                onClick={() => void createMut.mutate()}
              >
                {createMut.isPending ? 'Saving Alert…' : 'Save Search Alert 🔔'}
              </button>

              {createMut.error && (
                <p className="text-xs text-red-400 mt-2">{axiosErr(createMut.error)}</p>
              )}
            </div>

            <div
              className="p-3 rounded-xl border text-xs text-pleros-text-3 space-y-1"
              style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
            >
              <div className="font-semibold text-pleros-white flex items-center gap-1.5">
                <span>⚡</span> Instant Delivery
              </div>
              <p>Alerts trigger in real-time as soon as a seller’s listing completes review and goes live.</p>
            </div>
          </div>
        </div>

        {/* Active Alerts List (Right 2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <div
            className="rounded-2xl border p-6 space-y-4 shadow-xl"
            style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}
          >
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
              <div>
                <h2 className="text-base font-semibold text-pleros-white">Active Alerts</h2>
                <p className="text-xs text-pleros-text-3">Your configured keyword and category subscriptions</p>
              </div>
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: 'var(--c-surface-2)', color: 'var(--c-text-2)' }}
              >
                {searchesQ.data?.length ?? 0} active
              </span>
            </div>

            {searchesQ.isLoading ? (
              <p className="text-sm text-pleros-text-3 py-6 text-center">Loading alerts…</p>
            ) : (searchesQ.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon="🔔"
                title="No saved search alerts"
                description="Create alerts using the form on the left to monitor wholesale stock additions."
              />
            ) : (
              <div className="space-y-2.5">
                {(searchesQ.data ?? []).map((s) => (
                  <div
                    key={s.id}
                    className="p-4 rounded-xl border flex items-center justify-between transition-all"
                    style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface-2)' }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-base"
                        style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)' }}
                      >
                        🔔
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-pleros-white">
                            {s.query ? `"${s.query}"` : 'All inventory'}
                          </span>
                          {s.category && (
                            <span
                              className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                              style={{ background: 'var(--c-surface)', color: 'var(--c-accent)' }}
                            >
                              {s.category}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-pleros-text-3">
                          Email notifications active on new matching lots
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded hover:bg-red-500/10 transition-colors"
                      disabled={delMut.isPending}
                      onClick={() => void delMut.mutate(s.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
