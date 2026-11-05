import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { adminPath } from '@/lib/admin-path'
import { Link } from 'react-router-dom'
import { useViewer } from '@/components/purchasing/use-viewer'
import { singleFlight } from '@/lib/buyer-quote'
import {
  QUOTE_FILTERS,
  adminActionError,
  adminQuoteActions,
  approveBody,
  canStaffAcceptOffer,
  offerNote,
  offerSideLabel,
  rejectBody,
} from '@/lib/admin-quote'

type QuoteRow = {
  id: string
  status: string
  /** Sent back with approve / reject: the version this page shows (Ticket #3, Phase 7). */
  version: number
  quoteNumber?: string
  customerRef: string
  notes?: string | null
  rejectionReason?: string | null
  convertedOrderId?: string | null
  customerName?: string
  createdAt: string
  approvedAt?: string | null
  withdrawnAt?: string | null
  withdrawReason?: string | null
  lines: Array<{ lineNo: number; skuCode?: string | null; description: string; qty: number; unitPrice: string | number }>
}

type CounterOffer = {
  id: string
  offeredBy: string
  side?: string | null
  status: string
  notes?: string | null
  createdAt: string
  lines: Array<{ lineNo: number; qty: number; unitPrice: string | number }>
}

/** Where a failed action is reported: under its list row, in the quote dialog, or in the reject dialog. */
type Failure = { id: string; where: 'list' | 'detail' | 'reject'; conflict: boolean; message: string }

function quoteTotal(q: QuoteRow): number {
  return q.lines.reduce((s, l) => s + l.qty * Number(l.unitPrice), 0)
}

function quoteLabel(q: QuoteRow): string {
  if (q.quoteNumber) return q.quoteNumber
  return q.id.startsWith('seed_quote_') ? `Q-${q.id.replace('seed_quote_', '').toUpperCase()}` : `Q-${q.id.slice(-6).toUpperCase()}`
}

const fmtDate = (d: string) => new Date(d).toLocaleDateString()

function FailureNote({ failure, onReload }: { failure: Failure; onReload: () => void }) {
  return (
    <div className="text-xs mt-1 whitespace-normal max-w-xs" role="alert" style={{ color: 'var(--c-danger)' }}>
      <p>{failure.message}</p>
      {failure.conflict ? (
        <button type="button" className="btn-ghost !py-1 !px-2 !text-xs mt-1" onClick={onReload}>
          Reload latest version
        </button>
      ) : null}
    </div>
  )
}

export default function AdminQuotesPage() {
  const qc = useQueryClient()
  const { viewer } = useViewer()
  const [filter, setFilter] = useState('PENDING_APPROVAL')
  /** The quote being rejected, as it was when the dialog opened: its version is the one sent. */
  const [reject, setReject] = useState<QuoteRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [counterNotes, setCounterNotes] = useState('')
  const [counterLines, setCounterLines] = useState<Record<number, { qty: string; unitPrice: string }>>({})
  const [failure, setFailure] = useState<Failure | null>(null)
  // One decision at a time: a double click never sends a second approve or reject.
  const [flight] = useState(singleFlight)

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
    mutationFn: ({ id, body }: { id: string; body: { expectedVersion: number } }) => api.post(`/quotes/${id}/approve`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'quotes'] }),
  })

  // Staff place the order for the customer at the approved prices (ticket 55).
  const orderMut = useMutation({
    mutationFn: (id: string) => api.post<QuoteRow>(`/quotes/${id}/submit`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'quotes'] }),
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { reason: string; expectedVersion: number } }) => api.post(`/quotes/${id}/reject`, body),
    onSuccess: () => {
      setReject(null)
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

  function report(id: string, where: Failure['where'], e: unknown) {
    setFailure({ id, where, ...adminActionError(e) })
  }

  /** Approves the quote exactly as shown (its loaded version). A 409 is reported, never retried with a newer one. */
  function approve(q: QuoteRow, where: 'list' | 'detail') {
    setFailure(null)
    void flight.run(async () => {
      try {
        await approveMut.mutateAsync({ id: q.id, body: approveBody(q) })
      } catch (e) {
        report(q.id, where, e)
      }
    })
  }

  function confirmReject() {
    const q = reject
    if (!q || !rejectReason.trim()) return
    setFailure(null)
    void flight.run(async () => {
      try {
        await rejectMut.mutateAsync({ id: q.id, body: rejectBody(q, rejectReason) })
      } catch (e) {
        report(q.id, 'reject', e) // the dialog and its reason stay open
      }
    })
  }

  /**
   * The admin's explicit "Reload latest version": refetches the list and the open quote. Typed input (reject reason,
   * counter-offer) is kept; an open reject dialog now targets the reloaded version, sent only on the next click.
   */
  async function reload(id: string) {
    setFailure(null)
    await qc.invalidateQueries({ queryKey: ['admin', 'quotes'] })
    if (reject?.id === id) {
      try {
        const fresh = await api.get<QuoteRow>(`/quotes/${encodeURIComponent(id)}`)
        setReject((r) => (r?.id === id ? fresh : r))
      } catch (e) {
        report(id, 'reject', e)
      }
    }
  }

  function openDetail(q: QuoteRow) {
    setDetailId(q.id)
    setFailure(null)
    setCounterLines(
      Object.fromEntries(q.lines.map((ln) => [ln.lineNo, { qty: String(ln.qty), unitPrice: String(Number(ln.unitPrice)) }])),
    )
    setCounterNotes('')
  }

  const rows = quotesQ.data ?? []
  const detail = detailQ.data
  const detailActions = detail ? adminQuoteActions(detail, viewer) : null

  // Lines that appear after a reload get starting values; what the admin already typed is kept.
  useEffect(() => {
    if (!detail) return
    setCounterLines((prev) => {
      const missing = detail.lines.filter((ln) => !prev[ln.lineNo])
      if (missing.length === 0) return prev
      return { ...prev, ...Object.fromEntries(missing.map((ln) => [ln.lineNo, { qty: String(ln.qty), unitPrice: String(Number(ln.unitPrice)) }])) }
    })
  }, [detail])

  const failureFor = (id: string, where: Failure['where']) =>
    failure?.id === id && failure.where === where ? <FailureNote failure={failure} onReload={() => void reload(id)} /> : null

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white" style={{ fontFamily: 'var(--font-display)' }}>
          Quote approvals
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
          Review buyer quote requests, counter-offers and approvals, and create orders from approved quotes.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUOTE_FILTERS.map((s) => (
          <button key={s} type="button" className={filter === s ? 'btn-primary' : 'btn-ghost'} onClick={() => setFilter(s)}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {orderMut.data?.convertedOrderId ? (
        <p className="text-sm" role="status" style={{ color: 'var(--c-success)' }}>
          Order created from the quote.{' '}
          <Link to={adminPath(`/orders/${orderMut.data.convertedOrderId}`)} className="text-pleros-accent">
            View order →
          </Link>
        </p>
      ) : null}

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
              {rows.map((q) => {
                const actions = adminQuoteActions(q, viewer)
                return (
                  <tr key={q.id} data-quote-id={q.id}>
                    <td className="font-mono text-xs font-semibold text-pleros-white">#{quoteLabel(q)}</td>
                    <td className="text-sm font-medium">{q.customerName ?? q.customerRef}</td>
                    <td className="font-mono">${quoteTotal(q).toFixed(2)}</td>
                    <td>
                      <StatusBadge status={q.status} />
                      {q.status === 'WITHDRAWN' && q.withdrawnAt ? (
                        <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
                          Withdrawn {fmtDate(q.withdrawnAt)}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>
                      {fmtDate(q.createdAt)}
                    </td>
                    <td className="space-x-2 whitespace-nowrap">
                      <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => openDetail(q)}>
                        View
                      </button>
                      {actions.approve ? (
                        <button
                          type="button"
                          className="btn-primary !py-1 !px-2 !text-xs"
                          disabled={approveMut.isPending}
                          onClick={() => approve(q, 'list')}
                        >
                          Approve
                        </button>
                      ) : null}
                      {actions.reject ? (
                        <button
                          type="button"
                          className="btn-ghost !py-1 !px-2 !text-xs"
                          onClick={() => {
                            setFailure(null)
                            setReject(q)
                          }}
                        >
                          Reject
                        </button>
                      ) : null}
                      {actions.createOrder ? (
                        <button
                          type="button"
                          className="btn-primary !py-1 !px-2 !text-xs"
                          disabled={orderMut.isPending}
                          onClick={() => {
                            setFailure(null)
                            orderMut.mutate(q.id, { onError: (e) => report(q.id, 'list', e) })
                          }}
                        >
                          {orderMut.isPending && orderMut.variables === q.id ? 'Creating order…' : 'Create order'}
                        </button>
                      ) : null}
                      {q.convertedOrderId ? (
                        <Link to={adminPath(`/orders/${q.convertedOrderId}`)} className="text-xs text-pleros-accent">
                          View order →
                        </Link>
                      ) : null}
                      {failureFor(q.id, 'list')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailId && detail && detailActions ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setDetailId(null)}
        >
          <div
            className="pleros-card max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-quote-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap justify-between gap-3 mb-4">
              <div>
                <h3 id="admin-quote-title" className="text-lg font-semibold text-pleros-white font-display">
                  Quote {quoteLabel(detail)}
                </h3>
                <p className="text-sm text-pleros-text-3 mt-1">
                  {detail.customerName ?? detail.customerRef} · created {fmtDate(detail.createdAt)} · ${quoteTotal(detail).toFixed(2)} total
                </p>
              </div>
              <StatusBadge status={detail.status} />
            </div>

            <div className="space-y-1 text-sm mb-4" data-testid="quote-history">
              {detail.status === 'WITHDRAWN' ? (
                <>
                  <p>
                    Withdrawn by the buyer{detail.withdrawnAt ? ` on ${new Date(detail.withdrawnAt).toLocaleString()}` : ''}.
                  </p>
                  <p style={{ color: 'var(--c-text-2)' }}>Reason: {detail.withdrawReason?.trim() || 'none given'}</p>
                </>
              ) : null}
              {detail.approvedAt && (detail.status === 'APPROVED' || detail.status === 'SUBMITTED') ? (
                <p>Approved {new Date(detail.approvedAt).toLocaleString()}.</p>
              ) : null}
              {detail.status === 'REJECTED' && detail.rejectionReason ? <p>Rejected: {detail.rejectionReason}</p> : null}
              {detail.convertedOrderId ? (
                <p>
                  <Link to={adminPath(`/orders/${detail.convertedOrderId}`)} className="text-pleros-accent">
                    View order →
                  </Link>
                </p>
              ) : null}
              {detail.notes ? <p style={{ color: 'var(--c-text-2)' }}>Notes: {detail.notes}</p> : null}
              {detailActions.lockedReason ? <p style={{ color: 'var(--c-text-3)' }}>{detailActions.lockedReason}</p> : null}
              {detailActions.readOnlyReason ? <p style={{ color: 'var(--c-text-3)' }}>{detailActions.readOnlyReason}</p> : null}
            </div>

            <table className="pleros-table text-sm mb-6">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Desc</th>
                  <th>Qty</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((ln) => (
                  <tr key={ln.lineNo}>
                    <td>{ln.lineNo}</td>
                    <td className="font-mono text-xs">{ln.skuCode ?? '—'}</td>
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
                  {(offersQ.data ?? []).map((o) => {
                    const note = offerNote(o)
                    return (
                      <li key={o.id} data-offer-id={o.id} className="rounded-lg p-3 border text-sm" style={{ borderColor: 'var(--c-border)' }}>
                        <div className="flex justify-between gap-2">
                          <span>
                            {offerSideLabel(o)} · <StatusBadge status={o.status} />
                          </span>
                          <span className="text-xs text-pleros-text-3">{new Date(o.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-xs mt-1" style={{ color: 'var(--c-text-2)' }}>
                          {[...o.lines]
                            .sort((a, b) => a.lineNo - b.lineNo)
                            .map((l) => `Line ${l.lineNo}: ${l.qty} × $${Number(l.unitPrice).toFixed(2)}`)
                            .join(' · ')}
                        </p>
                        {o.notes ? <p className="text-xs mt-1">{o.notes}</p> : null}
                        {note ? (
                          <p className="text-xs mt-1" style={{ color: 'var(--c-text-3)' }}>
                            {note}
                          </p>
                        ) : null}
                        {canStaffAcceptOffer(detail, o, viewer) ? (
                          <button
                            type="button"
                            className="btn-primary !py-1 !px-2 !text-xs mt-2"
                            disabled={acceptMut.isPending}
                            onClick={() => {
                              setFailure(null)
                              acceptMut.mutate(o.id, { onError: (e) => report(detail.id, 'detail', e) })
                            }}
                          >
                            Accept buyer counter
                          </button>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}

            {detailActions.counter ? (
              <div className="border-t pt-4 mb-4" style={{ borderColor: 'var(--c-border)' }}>
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
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={counterMut.isPending}
                    onClick={() => {
                      setFailure(null)
                      counterMut.mutate(undefined, { onError: (e) => report(detail.id, 'detail', e) })
                    }}
                  >
                    Send counter
                  </button>
                </div>
              </div>
            ) : null}

            <div className="border-t pt-4 flex flex-wrap gap-2 justify-end items-start" style={{ borderColor: 'var(--c-border)' }}>
              <div className="flex-1 min-w-0">{failureFor(detail.id, 'detail')}</div>
              <button type="button" className="btn-ghost" onClick={() => setDetailId(null)}>
                Close
              </button>
              {detailActions.reject ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setFailure(null)
                    setReject(detail)
                  }}
                >
                  Reject
                </button>
              ) : null}
              {detailActions.approve ? (
                <button type="button" className="btn-primary" disabled={approveMut.isPending} onClick={() => approve(detail, 'detail')}>
                  Approve
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {reject ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
          <div className="pleros-card max-w-md w-full space-y-3" role="dialog" aria-modal="true" aria-labelledby="reject-quote-title">
            <h3 id="reject-quote-title" style={{ color: 'var(--c-heading)' }}>
              Reject quote {quoteLabel(reject)}
            </h3>
            {reject.status !== 'PENDING_APPROVAL' ? (
              <p className="text-sm" role="status" style={{ color: 'var(--c-text-2)' }}>
                This quote is now {reject.status.replace(/_/g, ' ').toLowerCase()}, so it can no longer be rejected.
              </p>
            ) : null}
            <textarea
              className="pleros-input min-h-[80px]"
              placeholder="Reason"
              aria-label="Reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            {failureFor(reject.id, 'reject')}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setReject(null)
                  if (failure?.where === 'reject') setFailure(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!rejectReason.trim() || rejectMut.isPending || reject.status !== 'PENDING_APPROVAL'}
                onClick={confirmReject}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
