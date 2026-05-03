'use client'

import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'

type Snap = {
  id: string
  date: string
  ordersCount: number
  revenue: string | number
  skusActive: number
}

type ChartAccount = {
  id: string
  code: string
  name: string
  type: string
  isActive: boolean
}

type JournalLine = {
  id?: string
  accountId: string
  debit: string | number
  credit: string | number
  memo?: string | null
  account?: { code: string; name: string }
}

type Journal = {
  id: string
  description: string
  isPosted: boolean
  postedAt: string
  fiscalPeriodClosed?: boolean
  lines?: JournalLine[]
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

export default function FinancePage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'kpis' | 'journals' | 'chart'>('kpis')
  const [journalOpen, setJournalOpen] = useState(false)

  const snaps = useQuery<Snap[]>({
    queryKey: ['finance', 'kpi'],
    queryFn: () => api.get('/kpi/snapshots'),
    enabled: tab === 'kpis',
    refetchInterval: tab === 'kpis' ? 180_000 : false,
  })

  const journals = useQuery<Journal[]>({
    queryKey: ['finance', 'journals'],
    queryFn: () => api.get('/journal-entries'),
    enabled: tab === 'journals',
  })

  const accounts = useQuery<ChartAccount[]>({
    queryKey: ['chart-accounts'],
    queryFn: () => api.get('/chart-accounts'),
    enabled: tab === 'journals' || tab === 'chart' || journalOpen,
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white">Finance</h1>
          <p className="text-cosmos-muted text-sm mt-1">KPI history, general ledger journals, and chart of accounts.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex rounded-lg border border-cosmos-border overflow-hidden">
            {(['kpis', 'journals', 'chart'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`px-3 py-2 text-sm capitalize ${tab === id ? 'bg-cosmos-primary text-white' : 'text-cosmos-text'}`}
                onClick={() => setTab(id)}
              >
                {id === 'kpis' ? 'KPIs' : id === 'chart' ? 'Chart' : 'Journals'}
              </button>
            ))}
          </div>
          {tab === 'journals' && (
            <button
              type="button"
              onClick={() => setJournalOpen(true)}
              className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
            >
              New journal draft
            </button>
          )}
        </div>
      </div>

      {tab === 'kpis' && (
        <Card>
          <CardTitle>Daily KPI snapshots</CardTitle>
          <p className="text-xs text-cosmos-muted mt-1">From analytics-service (read-only).</p>
          {snaps.isLoading ? (
            <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
          ) : snaps.isError ? (
            <p className="text-sm text-red-400 mt-3">Could not load KPI history.</p>
          ) : (snaps.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="📊"
              title="No snapshots"
              description="Run analytics refresh or seed data to populate daily KPIs."
            />
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Orders</th>
                    <th className="pb-2 pr-4">Revenue</th>
                    <th className="pb-2">Active SKUs</th>
                  </tr>
                </thead>
                <tbody>
                  {(snaps.data ?? []).slice(0, 31).map((s) => (
                    <tr key={s.id} className="border-b border-cosmos-border/60">
                      <td className="py-2 pr-4 text-cosmos-text">{new Date(s.date).toLocaleDateString()}</td>
                      <td className="py-2 pr-4 font-mono text-cosmos-muted">{s.ordersCount}</td>
                      <td className="py-2 pr-4 text-cosmos-white">${Number(s.revenue).toFixed(2)}</td>
                      <td className="py-2 text-cosmos-muted">{s.skusActive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'journals' && (
        <Card>
          <CardTitle>Journal entries</CardTitle>
          <p className="text-xs text-cosmos-muted mt-1">
            Draft and posted entries from ledger-service. Posting requires tenant admin.
          </p>
          {journals.isLoading ? (
            <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
          ) : journals.isError ? (
            <p className="text-sm text-red-400 mt-3">Could not load journals.</p>
          ) : (journals.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon="📒"
              title="No journal entries"
              description="Create a balanced draft (debits = credits) or post from integrations."
            />
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                    <th className="pb-2 pr-4">ID</th>
                    <th className="pb-2 pr-4">Memo</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Lines</th>
                    <th className="pb-2">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {(journals.data ?? []).slice(0, 60).map((j) => (
                    <tr key={j.id} className="border-b border-cosmos-border/60">
                      <td className="py-2 pr-4 font-mono text-xs">
                        <Link href={`/finance/journals/${j.id}`} className="text-cosmos-primary hover:underline">
                          {j.id.slice(-12)}…
                        </Link>
                      </td>
                      <td className="py-2 pr-4 text-cosmos-muted max-w-[240px] truncate">{j.description}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={j.isPosted ? 'POSTED' : 'DRAFT'} />
                      </td>
                      <td className="py-2 pr-4 text-cosmos-muted">{j.lines?.length ?? '—'}</td>
                      <td className="py-2 text-xs text-cosmos-muted whitespace-nowrap">
                        {new Date(j.postedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'chart' && (
        <Card>
          <CardTitle>Chart of accounts</CardTitle>
          <p className="text-xs text-cosmos-muted mt-1">Read-only directory. Manage accounts via API or admin tools.</p>
          {accounts.isLoading ? (
            <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
          ) : accounts.isError ? (
            <p className="text-sm text-red-400 mt-3">Could not load accounts.</p>
          ) : (accounts.data?.length ?? 0) === 0 ? (
            <EmptyState icon="📐" title="No accounts" description="Seed chart accounts for your tenant in ledger-service." />
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                    <th className="pb-2 pr-4">Code</th>
                    <th className="pb-2 pr-4">Name</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {(accounts.data ?? []).map((a) => (
                    <tr key={a.id} className="border-b border-cosmos-border/60">
                      <td className="py-2 pr-4 font-mono text-cosmos-text">{a.code}</td>
                      <td className="py-2 pr-4 text-cosmos-white">{a.name}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={a.type} />
                      </td>
                      <td className="py-2 text-cosmos-muted">{a.isActive ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {journalOpen && (
        <NewJournalDrawer
          accounts={accounts.data ?? []}
          onClose={() => setJournalOpen(false)}
          onCreated={() => {
            setJournalOpen(false)
            void qc.invalidateQueries({ queryKey: ['finance', 'journals'] })
          }}
        />
      )}
    </div>
  )
}

function NewJournalDrawer(props: {
  accounts: ChartAccount[]
  onClose: () => void
  onCreated: () => void
}) {
  const [description, setDescription] = useState('')
  const [rows, setRows] = useState([
    { accountId: '', debit: '', credit: '' },
    { accountId: '', debit: '', credit: '' },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (!description.trim()) {
      setError('Description is required.')
      return
    }
    const lines = rows
      .map((r) => ({
        accountId: r.accountId,
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
      }))
      .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0))
    if (lines.length < 2) {
      setError('At least two lines with accounts and amounts are required.')
      return
    }
    const td = lines.reduce((s, l) => s + l.debit, 0)
    const tc = lines.reduce((s, l) => s + l.credit, 0)
    if (Math.abs(td - tc) > 0.001) {
      setError(`Debits (${td.toFixed(2)}) must equal credits (${tc.toFixed(2)}).`)
      return
    }
    setBusy(true)
    try {
      await api.post('/journal-entries', { description: description.trim(), lines })
      props.onCreated()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-lg bg-cosmos-surface border-l border-cosmos-border p-6 overflow-y-auto">
        <h2 className="text-lg font-semibold text-cosmos-white">New journal draft</h2>
        <p className="text-xs text-cosmos-muted mt-1">Balanced entry only. Tenant admin role required.</p>
        <label className="block mt-4 text-xs text-cosmos-muted">Description</label>
        <input
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p className="text-xs text-cosmos-muted mt-4">Lines (debit XOR credit per line)</p>
        {rows.map((r, idx) => (
          <div key={idx} className="mt-2 grid grid-cols-12 gap-2 items-center border border-cosmos-border rounded-md p-2">
            <select
              className="col-span-12 sm:col-span-5 rounded-md bg-cosmos-surface-2 border border-cosmos-border px-2 py-1.5 text-xs text-cosmos-text"
              value={r.accountId}
              onChange={(e) => {
                const n = [...rows]
                n[idx] = { ...r, accountId: e.target.value }
                setRows(n)
              }}
            >
              <option value="">Account…</option>
              {props.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Debit"
              className="col-span-6 sm:col-span-3 rounded-md bg-cosmos-surface-2 border border-cosmos-border px-2 py-1.5 text-xs text-cosmos-text"
              value={r.debit}
              onChange={(e) => {
                const n = [...rows]
                n[idx] = { ...r, debit: e.target.value }
                setRows(n)
              }}
            />
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Credit"
              className="col-span-6 sm:col-span-3 rounded-md bg-cosmos-surface-2 border border-cosmos-border px-2 py-1.5 text-xs text-cosmos-text"
              value={r.credit}
              onChange={(e) => {
                const n = [...rows]
                n[idx] = { ...r, credit: e.target.value }
                setRows(n)
              }}
            />
          </div>
        ))}
        <button
          type="button"
          className="mt-2 text-xs text-cosmos-primary"
          onClick={() => setRows((x) => [...x, { accountId: '', debit: '', credit: '' }])}
        >
          + Line
        </button>
        {props.accounts.length === 0 && (
          <p className="text-amber-400 text-xs mt-2">No chart accounts loaded — open the Chart tab first or seed the ledger.</p>
        )}
        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-md border border-cosmos-border text-cosmos-text text-sm"
            onClick={props.onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            className="flex-1 h-10 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
            onClick={() => void submit()}
          >
            {busy ? 'Saving…' : 'Create draft'}
          </button>
        </div>
      </div>
    </div>
  )
}
