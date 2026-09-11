import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { EmptyState } from '@/components/pleros/empty-state'
import { StatusBadge } from '@/components/pleros/status-badge'
import { showToast } from '@/lib/toast'

type ChartAccount = { id: string; code: string; name: string; type: string }

type JournalLine = {
  accountId: string
  debit: number
  credit: number
  memo?: string
}

type JournalEntry = {
  id: string
  description: string
  isPosted: boolean
  postedAt: string
  lines: Array<{ debit: string | number; credit: string | number }>
}

type DraftLine = { accountId: string; debit: string; credit: string; memo: string }

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

const emptyLine = (): DraftLine => ({ accountId: '', debit: '', credit: '', memo: '' })

export function GeneralLedgerTab() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [fromIso, setFromIso] = useState('')
  const [toIso, setToIso] = useState('')
  const [accountId, setAccountId] = useState('')
  const [postedOnly, setPostedOnly] = useState(true)
  const [applied, setApplied] = useState({ fromIso: '', toIso: '', accountId: '', postedOnly: true })
  const [showForm, setShowForm] = useState(false)
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()])
  const [error, setError] = useState<string | null>(null)

  const accountsQ = useQuery({
    queryKey: ['finance', 'chart-accounts'],
    queryFn: () => api.get<ChartAccount[]>('/chart-accounts'),
  })

  const entriesQ = useQuery({
    queryKey: ['finance', 'journal-entries', applied],
    queryFn: () => {
      const q = new URLSearchParams()
      if (applied.fromIso) q.set('fromIso', applied.fromIso)
      if (applied.toIso) q.set('toIso', applied.toIso)
      if (applied.accountId) q.set('accountId', applied.accountId)
      if (applied.postedOnly) q.set('postedOnly', 'true')
      const qs = q.toString()
      return api.get<JournalEntry[]>(`/journal-entries${qs ? `?${qs}` : ''}`)
    },
  })

  const totals = useMemo(() => {
    let debits = 0
    let credits = 0
    for (const line of lines) {
      debits += parseFloat(line.debit) || 0
      credits += parseFloat(line.credit) || 0
    }
    return { debits, credits, imbalance: debits - credits }
  }, [lines])

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        description: description.trim(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          memo: l.memo.trim() || undefined,
        })) satisfies JournalLine[],
      }
      const draft = await api.post<{ id: string }>('/journal-entries', payload)
      await api.post(`/journal-entries/${encodeURIComponent(draft.id)}/post`, {})
      return draft
    },
    onSuccess: (draft) => {
      setError(null)
      setShowForm(false)
      setDescription('')
      setLines([emptyLine(), emptyLine()])
      void qc.invalidateQueries({ queryKey: ['finance', 'journal-entries'] })
      showToast(`Journal entry posted: ${description.trim()}`)
      navigate(adminPath(`/finance/journals/${draft.id}`))
    },
    onError: (e) => setError(errMsg(e)),
  })

  const canSave =
    description.trim().length > 0 &&
    lines.length >= 2 &&
    lines.every((l) => l.accountId) &&
    Math.abs(totals.imbalance) < 0.005 &&
    totals.debits > 0

  return (
    <div className="space-y-4">
      {!showForm ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
              From
              <input type="date" className="pleros-input" value={fromIso} onChange={(e) => setFromIso(e.target.value)} />
            </label>
            <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
              To
              <input type="date" className="pleros-input" value={toIso} onChange={(e) => setToIso(e.target.value)} />
            </label>
            <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
              Account
              <select className="pleros-input min-w-[180px]" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">All accounts</option>
                {(accountsQ.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer" style={{ color: 'var(--c-text-2)' }}>
              <input type="checkbox" checked={postedOnly} onChange={(e) => setPostedOnly(e.target.checked)} />
              Posted only
            </label>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setApplied({ fromIso, toIso, accountId, postedOnly })}
            >
              Apply filters
            </button>
            <button type="button" className="btn-primary ml-auto" onClick={() => setShowForm(true)}>
              New journal entry
            </button>
          </div>

          <div className="pleros-card overflow-x-auto">
            {entriesQ.isLoading ? (
              <div className="skeleton h-40 w-full" />
            ) : (entriesQ.data?.length ?? 0) === 0 ? (
              <EmptyState icon="📖" title="No journal entries" description="Adjust filters or post a manual journal entry." />
            ) : (
              <table className="pleros-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Posted</th>
                    <th className="text-right">Total debits</th>
                  </tr>
                </thead>
                <tbody>
                  {(entriesQ.data ?? []).map((entry) => {
                    const totalDebits = entry.lines.reduce((s, l) => s + Number(l.debit), 0)
                    return (
                      <tr key={entry.id}>
                        <td>{new Date(entry.postedAt).toLocaleDateString()}</td>
                        <td>
                          <Link to={adminPath(`/finance/journals/${entry.id}`)} className="text-pleros-accent hover:underline">
                            {entry.description}
                          </Link>
                        </td>
                        <td>
                          <StatusBadge status={entry.isPosted ? 'COMPLETED' : 'DRAFT'} />
                        </td>
                        <td className="text-right font-mono">{money(totalDebits)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <div className="pleros-card space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 style={{ color: 'var(--c-heading)', fontFamily: 'var(--font-display)' }}>New journal entry</h3>
            <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>
              Back to ledger
            </button>
          </div>
          <label className="block text-sm" style={{ color: 'var(--c-text-2)' }}>
            Description
            <input className="pleros-input mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_2fr_auto] items-end">
                <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                  Account
                  <select
                    className="pleros-input"
                    value={line.accountId}
                    onChange={(e) =>
                      setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, accountId: e.target.value } : row)))
                    }
                  >
                    <option value="">Select…</option>
                    {(accountsQ.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                  Debit
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="pleros-input"
                    value={line.debit}
                    onChange={(e) =>
                      setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, debit: e.target.value } : row)))
                    }
                  />
                </label>
                <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                  Credit
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="pleros-input"
                    value={line.credit}
                    onChange={(e) =>
                      setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, credit: e.target.value } : row)))
                    }
                  />
                </label>
                <label className="text-xs space-y-1" style={{ color: 'var(--c-text-3)' }}>
                  Memo
                  <input
                    className="pleros-input"
                    value={line.memo}
                    onChange={(e) =>
                      setLines((prev) => prev.map((row, i) => (i === idx ? { ...row, memo: e.target.value } : row)))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="btn-ghost !text-xs"
                  disabled={lines.length <= 2}
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <button type="button" className="btn-ghost !text-sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
            Add line
          </button>

          <div
            className="rounded-lg p-3 text-sm"
            style={{
              background: Math.abs(totals.imbalance) < 0.005 ? 'var(--c-success-soft)' : 'var(--c-warning-soft)',
              color: Math.abs(totals.imbalance) < 0.005 ? 'var(--c-success)' : 'var(--c-warning)',
            }}
          >
            Debits {money(totals.debits)} · Credits {money(totals.credits)}
            {Math.abs(totals.imbalance) >= 0.005 && ` · Imbalance ${money(totals.imbalance)}`}
            {Math.abs(totals.imbalance) < 0.005 && totals.debits > 0 && ' · Entry is balanced'}
          </div>

          {error && (
            <p className="text-sm" style={{ color: 'var(--c-danger)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={!canSave || saveMut.isPending} onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? 'Posting…' : 'Save & post'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
