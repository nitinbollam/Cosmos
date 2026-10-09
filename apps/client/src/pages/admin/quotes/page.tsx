import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'

type QuoteRow = {
  id: string
  status: string
  customerRef: string
  notes?: string | null
  rejectionReason?: string | null
  createdAt: string
  lines: Array<{ lineNo: number; skuCode?: string | null; description: string; qty: number; unitPrice: string | number }>
}

type CounterOffer = {
  id: string
  offeredBy: string
  status: string
  notes?: string | null
  createdAt: string
  lines: Array<{ lineNo: number; qty: number; unitPrice: string | number }>
}

function quoteTotal(q: QuoteRow): number {
  return q.lines.reduce((s, l) => s + l.qty * Number(l.unitPrice), 0)
}

export default function AdminQuotesPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState('PENDING_APPROVAL')
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [counterNotes, setCounterNotes] = useState('')
  const [counterLines, setCounterLines] = useState<Record<number, { qty: string; unitPrice: string }>>({})

  const quotesQ = useQuery({
    queryKey: ['admin', 'quotes', filter],
    queryFn: () => api.get<QuoteRow[]>(`/quotes${filter !== 'ALL' ? `?status=${filter}` : ''}`),
  })

  const detailQ = useQuery({
    queryKey: ['admin', 'quotes', detailId],
    queryFn: () => api.get<QuoteRow>(`/quotes/${encodeURIComponent(detailId!)}`),
    enabled: !!detailId,
  })

  const offersQ = useQuery({
    queryKey: ['admin', 'quotes', detailId, 'counter-offers'],
    queryFn: () => api.get<CounterOffer[]>(`/quotes/${encodeURIComponent(detailId!)}/counter-offers`),
    enabled: !!detailId,
  })

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/quotes/${id}/approve`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'quotes'] }),
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/quotes/${id}/reject`, { reason }),
    onSuccess: () => {
      setRejectId(null)
      setRejectReason('')
      void qc.invalidateQueries({ queryKey: ['admin', 'quotes'] })
    },
  })

  const counterMut = useMutation({
    mutationFn: () => {
      const q = detailQ.data!
      return api.post(`/quotes/${encodeURIComponent(detailId!)}/counter-offers`, {
        offeredBy: 'ADMIN',
        notes: counterNotes.trim() || undefined,
        lines: q.lines.map((ln) => ({
          lineNo: ln.lineNo,
          qty: Number.parseInt(counterLines[ln.lineNo]?.qty ?? String(ln.qty), 10),
          unitPrice: Number.parseFloat(counterLines[ln.lineNo]?.unitPrice ?? String(ln.unitPrice)),
        })),
      })
    },
    onSuccess: () => {
      setCounterNotes('')
      void qc.invalidateQueries({ queryKey: ['admin', 'quotes', detailId, 'counter-offers'] })
    },
  })

  const acceptMut = useMutation({
    mutationFn: (counterOfferId: string) =>
      api.post(`/quotes/${encodeURIComponent(detailId!)}/counter-offers/accept`, { counterOfferId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'quotes'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'quotes', detailId] })
      void qc.invalidateQueries({ queryKey: ['admin', 'quotes', detailId, 'counter-offers'] })
    },
  })

  function openDetail(q: QuoteRow) {
    setDetailId(q.id)
    setCounterLines(
      Object.fromEntries(q.lines.map((ln) => [ln.lineNo, { qty: String(ln.qty), unitPrice: String(Number(ln.unitPrice)) }])),
    )
    setCounterNotes('')
  }

  const rows = quotesQ.data ?? []
  const detail = detailQ.data

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white" style={{ fontFamily: 'var(--font-display)' }}>
          Quote approvals
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
          Review buyer quote requests, counter-offers, and approvals.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'OPEN', 'SUBMITTED', 'ALL'].map((s) => (
          <button key={s} type="button" className={filter === s ? 'btn-primary' : 'btn-ghost'} onClick={() => setFilter(s)}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="pleros-card overflow-x-auto">
        {quotesQ.isLoading ? (
          <div className="skeleton h-40 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState icon="📝" title="No quotes" description="Buyer-submitted quotes awaiting approval appear here." />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>Quote</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td className="font-mono text-xs font-semibold text-pleros-white">
                    #{q.id.startsWith('seed_quote_') ? `Q-${q.id.replace('seed_quote_', '').toUpperCase()}` : `Q-${q.id.slice(-6).toUpperCase()}`}
                  </td>
                  <td className="text-sm font-medium">{q.customerRef.startsWith('cust_') ? `Customer #${q.customerRef.slice(-6).toUpperCase()}` : q.customerRef}</td>
                  <td className="font-mono">${quoteTotal(q).toFixed(2)}</td>
                  <td>
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>
                    {new Date(q.createdAt).toLocaleDateString()}
                  </td>
                  <td className="space-x-2 whitespace-nowrap">
                    <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => openDetail(q)}>
                      View
                    </button>
                    {q.status === 'PENDING_APPROVAL' ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary !py-1 !px-2 !text-xs"
                          disabled={approveMut.isPending}
                          onClick={() => void approveMut.mutate(q.id)}
                        >
                          Approve
                        </button>
                        <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => setRejectId(q.id)}>
                          Reject
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rejectId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="pleros-card max-w-md w-full space-y-3">
            <h3 style={{ color: 'var(--c-heading)' }}>Reject quote</h3>
            <textarea
              className="pleros-input min-h-[80px]"
              placeholder="Reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setRejectId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!rejectReason.trim() || rejectMut.isPending}
                onClick={() => void rejectMut.mutate({ id: rejectId, reason: rejectReason })}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailId && detail ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setDetailId(null)}
        >
          <div className="pleros-card max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-wrap justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-semibold text-pleros-white font-display">Quote {detail.id.slice(-12)}</h3>
                <p className="text-sm text-pleros-text-3 mt-1">${quoteTotal(detail).toFixed(2)} total</p>
              </div>
              <StatusBadge status={detail.status} />
            </div>

            <table className="pleros-table text-sm mb-6">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Desc</th>
                  <th>Qty</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((ln) => (
                  <tr key={ln.lineNo}>
                    <td>{ln.lineNo}</td>
                    <td>{ln.description}</td>
                    <td>{ln.qty}</td>
                    <td className="font-mono">${Number(ln.unitPrice).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {(offersQ.data ?? []).length > 0 ? (
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-pleros-white mb-2">Counter-offers</h4>
                <ul className="space-y-2">
                  {(offersQ.data ?? []).map((o) => (
                    <li key={o.id} className="rounded-lg p-3 border text-sm" style={{ borderColor: 'var(--c-border)' }}>
                      <div className="flex justify-between gap-2">
                        <span>
                          {o.offeredBy} · <StatusBadge status={o.status} />
                        </span>
                        <span className="text-xs text-pleros-text-3">{new Date(o.createdAt).toLocaleString()}</span>
                      </div>
                      {o.status === 'OPEN' && o.offeredBy === 'BUYER' ? (
                        <button
                          type="button"
                          className="btn-primary !py-1 !px-2 !text-xs mt-2"
                          disabled={acceptMut.isPending}
                          onClick={() => acceptMut.mutate(o.id)}
                        >
                          Accept buyer counter
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="border-t pt-4" style={{ borderColor: 'var(--c-border)' }}>
              <h4 className="text-sm font-semibold text-pleros-white mb-2">Send admin counter-offer</h4>
              <textarea
                className="pleros-input min-h-[60px] mb-3"
                placeholder="Notes"
                value={counterNotes}
                onChange={(e) => setCounterNotes(e.target.value)}
              />
              <ul className="space-y-2 mb-4">
                {detail.lines.map((ln) => (
                  <li key={ln.lineNo} className="flex flex-wrap gap-2 items-center text-sm">
                    <span className="flex-1 truncate">{ln.description}</span>
                    <input
                      type="number"
                      className="pleros-input w-16"
                      value={counterLines[ln.lineNo]?.qty ?? ''}
                      onChange={(e) =>
                        setCounterLines((prev) => ({
                          ...prev,
                          [ln.lineNo]: {
                            qty: e.target.value,
                            unitPrice: prev[ln.lineNo]?.unitPrice ?? String(ln.unitPrice),
                          },
                        }))
                      }
                    />
                    <input
                      type="number"
                      step="0.01"
                      className="pleros-input w-24"
                      value={counterLines[ln.lineNo]?.unitPrice ?? ''}
                      onChange={(e) =>
                        setCounterLines((prev) => ({
                          ...prev,
                          [ln.lineNo]: { qty: prev[ln.lineNo]?.qty ?? String(ln.qty), unitPrice: e.target.value },
                        }))
                      }
                    />
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 justify-end">
                <button type="button" className="btn-ghost" onClick={() => setDetailId(null)}>
                  Close
                </button>
                <button type="button" className="btn-primary" disabled={counterMut.isPending} onClick={() => counterMut.mutate()}>
                  Send counter
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
