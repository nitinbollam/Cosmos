import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { StatusBadge } from '@/components/pleros/status-badge'

type ChartAccount = {
  id: string
  code: string
  name: string
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
  isActive: boolean
}

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

export function ChartOfAccountsTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ChartAccount | null>(null)
  const [formCode, setFormCode] = useState('')
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<(typeof ACCOUNT_TYPES)[number]>('ASSET')
  const [formActive, setFormActive] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const accountsQ = useQuery({
    queryKey: ['finance', 'chart-accounts'],
    queryFn: () => api.get<ChartAccount[]>('/chart-accounts'),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (accountsQ.data ?? []).filter((a) => {
      if (typeFilter && a.type !== typeFilter) return false
      if (!q) return true
      return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
    })
  }, [accountsQ.data, search, typeFilter])

  const createMut = useMutation({
    mutationFn: () =>
      api.post<ChartAccount>('/chart-accounts', {
        code: formCode.trim(),
        name: formName.trim(),
        type: formType,
        isActive: formActive,
      }),
    onSuccess: () => {
      setError(null)
      setCreateOpen(false)
      setFormCode('')
      setFormName('')
      setFormType('ASSET')
      setFormActive(true)
      void qc.invalidateQueries({ queryKey: ['finance', 'chart-accounts'] })
    },
    onError: (e) => setError(errMsg(e)),
  })

  const patchMut = useMutation({
    mutationFn: () =>
      api.patch<ChartAccount>(`/chart-accounts/${encodeURIComponent(editTarget!.id)}`, {
        name: formName.trim(),
        isActive: formActive,
      }),
    onSuccess: () => {
      setError(null)
      setEditTarget(null)
      void qc.invalidateQueries({ queryKey: ['finance', 'chart-accounts'] })
    },
    onError: (e) => setError(errMsg(e)),
  })

  function openCreate() {
    setError(null)
    setFormCode('')
    setFormName('')
    setFormType('ASSET')
    setFormActive(true)
    setCreateOpen(true)
  }

  function openEdit(account: ChartAccount) {
    setError(null)
    setEditTarget(account)
    setFormName(account.name)
    setFormActive(account.isActive)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <input
            className="pleros-input min-w-[200px]"
            placeholder="Search code or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="pleros-input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn-primary" onClick={openCreate}>
          New account
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--c-danger)' }}>
          {error}
        </p>
      )}

      <div className="pleros-card overflow-x-auto">
        {accountsQ.isLoading ? (
          <div className="skeleton h-40 w-full" />
        ) : (accountsQ.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="📒"
            title="No chart of accounts yet"
            description="A chart of accounts lists every ledger account your business uses — create your first account to start posting journal entries."
          />
        ) : filtered.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
            No accounts match your filters.
          </p>
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((account) => (
                <tr
                  key={account.id}
                  className="cursor-pointer hover:opacity-90"
                  onClick={() => openEdit(account)}
                >
                  <td className="font-mono text-xs font-semibold">{account.code}</td>
                  <td>{account.name}</td>
                  <td>
                    <StatusBadge status={account.type} />
                  </td>
                  <td>{account.isActive ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(createOpen || editTarget) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="pleros-card max-w-md w-full space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ color: 'var(--c-heading)', fontFamily: 'var(--font-display)' }}>
              {editTarget ? 'Edit account' : 'New account'}
            </h3>
            {!editTarget && (
              <>
                <label className="block text-sm" style={{ color: 'var(--c-text-2)' }}>
                  Code
                  <input className="pleros-input mt-1" value={formCode} onChange={(e) => setFormCode(e.target.value)} />
                </label>
                <label className="block text-sm" style={{ color: 'var(--c-text-2)' }}>
                  Type
                  <select className="pleros-input mt-1" value={formType} onChange={(e) => setFormType(e.target.value as typeof formType)}>
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {editTarget && (
              <p className="text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
                {editTarget.code} · {editTarget.type}
              </p>
            )}
            <label className="block text-sm" style={{ color: 'var(--c-text-2)' }}>
              Name
              <input className="pleros-input mt-1" value={formName} onChange={(e) => setFormName(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
              <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
              Active
            </label>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setCreateOpen(false)
                  setEditTarget(null)
                  setError(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={createMut.isPending || patchMut.isPending || !formName.trim() || (!editTarget && !formCode.trim())}
                onClick={() => {
                  if (editTarget) patchMut.mutate()
                  else createMut.mutate()
                }}
              >
                {createMut.isPending || patchMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
