import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'

type JournalLine = {
  id: string
  accountId: string
  debit: string | number
  credit: string | number
  memo?: string | null
  account?: { code: string; name: string; type?: string }
}

type Journal = {
  id: string
  description: string
  isPosted: boolean
  postedAt: string
  fiscalPeriodClosed?: boolean
  lines: JournalLine[]
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

export default function JournalDetailPage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : params.id?.[0] ?? ''
  const qc = useQueryClient()

  const q = useQuery<Journal>({
    queryKey: ['journal-entry', id],
    queryFn: () => api.get(`/journal-entries/${encodeURIComponent(id)}`),
    enabled: !!id,
  })

  const post = useMutation({
    mutationFn: () => api.post(`/journal-entries/${encodeURIComponent(id)}/post`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['journal-entry', id] })
      void qc.invalidateQueries({ queryKey: ['finance', 'journals'] })
    },
  })

  if (!id) return null

  const j = q.data
  const totalDebit = (j?.lines ?? []).reduce((s, l) => s + Number(l.debit), 0)
  const totalCredit = (j?.lines ?? []).reduce((s, l) => s + Number(l.credit), 0)

  return (
    <div className="p-6 space-y-6">
      <Link to="/admin/finance" className="text-sm text-pleros-muted hover:text-pleros-white">
        ← Finance
      </Link>

      {q.isLoading ? (
        <p className="text-pleros-muted">Loading…</p>
      ) : q.error || !j ? (
        <p className="text-red-400">Journal not found</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-pleros-white">Journal entry</h1>
              <p className="font-mono text-xs text-pleros-muted mt-1">{j.id}</p>
              <div className="mt-2">
                <StatusBadge status={j.isPosted ? 'POSTED' : 'DRAFT'} />
              </div>
              <p className="text-pleros-muted text-sm mt-3 max-w-2xl">{j.description}</p>
            </div>
            {!j.isPosted && (
              <button
                type="button"
                disabled={post.isPending}
                onClick={() => post.mutate()}
                className="h-10 px-4 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-40"
              >
                {post.isPending ? 'Posting…' : 'Post entry'}
              </button>
            )}
          </div>
          {post.error && <p className="text-red-400 text-sm">{errMsg(post.error)}</p>}

          <Card>
            <CardTitle>Lines</CardTitle>
            <p className="text-xs text-pleros-muted mt-1">
              Totals — debit {totalDebit.toFixed(2)} · credit {totalCredit.toFixed(2)}
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-pleros-muted border-b border-pleros-border">
                    <th className="pb-2 pr-4">Account</th>
                    <th className="pb-2 pr-4">Memo</th>
                    <th className="pb-2 pr-4">Debit</th>
                    <th className="pb-2">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {j.lines.map((l) => (
                    <tr key={l.id} className="border-b border-pleros-border/60">
                      <td className="py-2 pr-4">
                        <span className="font-mono text-pleros-text">{l.account?.code ?? l.accountId}</span>
                        <span className="text-pleros-muted"> — {l.account?.name ?? '—'}</span>
                      </td>
                      <td className="py-2 pr-4 text-pleros-muted max-w-[200px] truncate">{l.memo ?? '—'}</td>
                      <td className="py-2 pr-4 font-mono text-pleros-text">
                        {Number(l.debit) > 0 ? Number(l.debit).toFixed(2) : '—'}
                      </td>
                      <td className="py-2 font-mono text-pleros-text">
                        {Number(l.credit) > 0 ? Number(l.credit).toFixed(2) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardTitle>Metadata</CardTitle>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-pleros-muted">Last updated</dt>
                <dd className="text-pleros-text">{new Date(j.postedAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-pleros-muted">Fiscal period closed flag</dt>
                <dd className="text-pleros-text">{j.fiscalPeriodClosed ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </Card>
        </>
      )}
    </div>
  )
}
