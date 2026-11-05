import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { StatusBadge } from '@/components/status-badge'
import { PlerosDialogModal } from '@/components/pleros/radix-overlays'
import { QuoteLinesEditor } from '@/components/quotes/quote-lines-editor'
import type { QuoteLineDraft } from '@/lib/quote-lines'
import {
  actionError,
  buildEditBody,
  buildWithdrawBody,
  canAcceptOffer,
  editDraft,
  MAX_NOTES,
  MAX_WITHDRAW_REASON,
  quoteActions,
  singleFlight,
  type ActionError,
  type BuyerQuote,
} from '@/lib/buyer-quote'

type Line = {
  id: string
  lineNo: number
  skuCode?: string | null
  description: string
  qty: number
  unitPrice: string | number
}

type CounterOffer = {
  id: string
  offeredBy: string
  status: string
  notes?: string | null
  createdAt: string
  lines: Array<{ lineNo: number; qty: number; unitPrice: string | number }>
}

type QuoteDetail = Omit<BuyerQuote, 'lines'> & {
  quoteNumber?: string
  customerRef: string
  customerName?: string
  rejectionReason?: string | null
  createdAt?: string
  lines: Line[]
}

type Draft = { notes: string; lines: QuoteLineDraft[] }

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const [searchParams, setSearchParams] = useSearchParams()
  const [q, setQ] = useState<QuoteDetail | null>(null)
  const [offers, setOffers] = useState<CounterOffer[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [counterOpen, setCounterOpen] = useState(false)
  const [counterNotes, setCounterNotes] = useState('')
  const [counterLines, setCounterLines] = useState<Record<number, { qty: string; unitPrice: string }>>({})

  // Edit and withdraw (Phase 6). One request at a time each: a double click never sends twice.
  const flight = useRef(singleFlight())
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [editErr, setEditErr] = useState<ActionError | null>(null)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [withdrawErr, setWithdrawErr] = useState<ActionError | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const autoOpened = useRef(false)
  // The dialogs are opened by plain buttons (no Radix trigger), so Radix has nowhere to send focus on close:
  // remember what opened them and focus it again, or the page heading if that button is gone (e.g. withdrawn).
  const returnFocus = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [data, co] = await Promise.all([
        api.get<QuoteDetail>(`/quotes/${id}`),
        api.get<CounterOffer[]>(`/quotes/${id}/counter-offers`).catch(() => [] as CounterOffer[]),
      ])
      setQ(data)
      setOffers(co)
      return data
    } catch (e: unknown) {
      setErr(axiosErr(e))
      return null
    }
  }, [id])

  useEffect(() => {
    if (id) void load()
  }, [id, load])

  const actions = q ? quoteActions(q) : null

  function rememberFocus() {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('[role="dialog"]')) return // reopened from inside a dialog
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : headingRef.current
  }

  useEffect(() => {
    if (editOpen || withdrawOpen || !returnFocus.current) return
    const target = returnFocus.current
    returnFocus.current = null
    const raf = requestAnimationFrame(() => (target.isConnected ? target : headingRef.current)?.focus())
    return () => cancelAnimationFrame(raf)
  }, [editOpen, withdrawOpen])

  function openEdit(from: QuoteDetail) {
    rememberFocus()
    setDraft(editDraft(from))
    setDirty(false)
    setEditErr(null)
    setConfirmDiscard(false)
    setNotice(null)
    setEditOpen(true)
  }

  function openWithdraw() {
    rememberFocus()
    setWithdrawReason('')
    setWithdrawErr(null)
    setNotice(null)
    setWithdrawOpen(true)
  }

  // "Edit" / "Withdraw" from the quote list land here with ?action=…; open it once, if the quote allows it, then
  // drop it from the URL so a reload (or Back) shows the quote instead of reopening the form.
  useEffect(() => {
    if (!q || autoOpened.current) return
    const wanted = searchParams.get('action')
    const a = quoteActions(q)
    if (wanted === 'edit' && a.edit) openEdit(q)
    if (wanted === 'withdraw' && a.withdraw) openWithdraw()
    autoOpened.current = true
    if (wanted !== null) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('action')
          return next
        },
        { replace: true },
      )
    }
  }, [q, searchParams, setSearchParams])

  function changeDraft(next: Draft) {
    setDraft(next)
    setDirty(true)
    setEditErr(null)
  }

  /** Closing with unsaved changes asks first: edits are never thrown away silently. */
  function requestCloseEdit() {
    if (dirty && !flight.current.busy) {
      setConfirmDiscard(true)
      return
    }
    setEditOpen(false)
  }

  async function saveEdit() {
    if (!q || !draft) return
    const built = buildEditBody(q, draft)
    if (!built.ok) {
      setEditErr({ kind: 'invalid', message: built.error })
      return
    }
    await flight.current.run(async () => {
      setBusy(true)
      setEditErr(null)
      try {
        await api.patch<QuoteDetail>(`/quotes/${id}`, built.body)
        setEditOpen(false)
        setDirty(false)
        setNotice(q.status === 'OPEN' ? 'Quote updated.' : 'Quote updated and moved back to Open. Submit it for approval when you are ready.')
        await load()
      } catch (e: unknown) {
        setEditErr(actionError(e))
      } finally {
        setBusy(false)
      }
    })
  }

  /** After a 409: load the latest quote and start the edit again from it (only when the buyer asks). */
  async function reloadLatestForEdit() {
    const latest = await load()
    if (latest && quoteActions(latest).edit) openEdit(latest)
    else {
      setEditOpen(false)
      setDirty(false)
    }
  }

  async function confirmWithdraw() {
    if (!q) return
    const built = buildWithdrawBody(q, withdrawReason)
    if (!built.ok) {
      setWithdrawErr({ kind: 'invalid', message: built.error })
      return
    }
    await flight.current.run(async () => {
      setBusy(true)
      setWithdrawErr(null)
      try {
        await api.post<QuoteDetail>(`/quotes/${id}/withdraw`, built.body)
        setNotice('Quote withdrawn. It stays in your quote list for your records.')
        // Reload before closing, so focus returns to the page as it now is (the Withdraw button is gone).
        await load()
        setWithdrawOpen(false)
      } catch (e: unknown) {
        setWithdrawErr(actionError(e))
      } finally {
        setBusy(false)
      }
    })
  }

  async function reloadAfterWithdrawConflict() {
    setWithdrawOpen(false)
    await load()
  }

  function openCounterForm() {
    if (!q) return
    setCounterLines(
      Object.fromEntries(
        q.lines.map((ln) => [ln.lineNo, { qty: String(ln.qty), unitPrice: String(Number(ln.unitPrice)) }]),
      ),
    )
    setCounterNotes('')
    setCounterOpen(true)
  }

  async function submitCounter() {
    if (!q) return
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/counter-offers`, {
        offeredBy: 'BUYER',
        notes: counterNotes.trim() || undefined,
        lines: q.lines.map((ln) => ({
          lineNo: ln.lineNo,
          qty: Number.parseInt(counterLines[ln.lineNo]?.qty ?? String(ln.qty), 10),
          unitPrice: Number.parseFloat(counterLines[ln.lineNo]?.unitPrice ?? String(ln.unitPrice)),
        })),
      })
      setCounterOpen(false)
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function acceptOffer(counterOfferId: string) {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/counter-offers/accept`, { counterOfferId })
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function requestApproval() {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/request-approval`, {})
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  async function placeOrder() {
    setBusy(true)
    setErr(null)
    try {
      await api.post(`/quotes/${id}/submit`, {})
      await load()
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="pleros-shop-page-main">
      <div>
        <Link to="/quotes" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
          ← All quotes
        </Link>
      </div>
      {err ? (
        <p className="pleros-shop-error" role="alert" style={{ marginTop: 16 }}>
          {err}
        </p>
      ) : null}
      {notice ? (
        <p className="pleros-shop-muted" role="status" style={{ marginTop: 16 }}>
          {notice}
        </p>
      ) : null}
      {!q && !err ? (
        <p className="pleros-shop-muted" style={{ marginTop: 24 }}>
          Loading…
        </p>
      ) : null}
      {q && actions ? (
        <div style={{ marginTop: 24 }}>
          <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: 22, color: 'var(--c-heading)', margin: 0, outline: 'none' }}>
            {q.quoteNumber || `Quote #${q.id.slice(-8).toUpperCase()}`}
          </h1>
          <p className="pleros-shop-muted" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ color: 'var(--c-text)' }}>{q.customerName || q.customerRef}</strong>
            <StatusBadge status={q.status} />
            {q.createdAt ? ` · ${new Date(q.createdAt).toLocaleString()}` : ''}
          </p>
          {q.rejectionReason ? (
            <p className="pleros-shop-error" style={{ marginTop: 12, fontSize: 14 }}>
              Rejected: {q.rejectionReason}
            </p>
          ) : null}
          {q.status === 'WITHDRAWN' ? (
            <p className="pleros-shop-subtle" style={{ marginTop: 12, fontSize: 14 }}>
              Withdrawn{q.withdrawnAt ? ` on ${new Date(q.withdrawnAt).toLocaleString()}` : ''}
              {q.withdrawReason ? `: ${q.withdrawReason}` : ''}
            </p>
          ) : null}
          {q.notes ? (
            <p className="pleros-shop-subtle" style={{ marginTop: 12, fontSize: 14, whiteSpace: 'pre-wrap' }}>
              {q.notes}
            </p>
          ) : null}
          {q.convertedOrderId ? (
            <p className="pleros-shop-inset">
              <span className="pleros-shop-muted" style={{ fontSize: 12 }}>
                Order created ·{' '}
              </span>
              <Link to={`/orders/${q.convertedOrderId}`} className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
                View order →
              </Link>
            </p>
          ) : null}
          {actions.lockedReason ? (
            <p className="pleros-shop-muted" style={{ marginTop: 12, fontSize: 13 }}>
              {actions.lockedReason}
            </p>
          ) : null}
          <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {actions.requestApproval ? (
              <button type="button" disabled={busy} onClick={() => void requestApproval()} className="btn-primary">
                {busy ? 'Submitting…' : 'Submit for approval'}
              </button>
            ) : null}
            {q.status === 'PENDING_APPROVAL' ? (
              <p className="pleros-shop-muted" style={{ fontSize: 14 }}>
                Awaiting admin approval…
              </p>
            ) : null}
            {actions.placeOrder ? (
              <button type="button" disabled={busy} onClick={() => void placeOrder()} className="btn-primary">
                {busy ? 'Placing order…' : 'Place order'}
              </button>
            ) : null}
            {actions.edit ? (
              <button type="button" disabled={busy} onClick={() => openEdit(q)} className="btn-ghost">
                Edit quote
              </button>
            ) : null}
            {actions.withdraw ? (
              <button type="button" disabled={busy} onClick={openWithdraw} className="btn-ghost">
                Withdraw quote
              </button>
            ) : null}
            {actions.counter ? (
              <button type="button" disabled={busy} onClick={openCounterForm} className="btn-ghost">
                Propose counter-offer
              </button>
            ) : null}
          </div>
          {actions.edit && actions.editWarning ? (
            <p className="pleros-shop-muted" style={{ marginTop: 8, fontSize: 12 }}>
              {actions.editWarning}
            </p>
          ) : null}

          {offers.length > 0 ? (
            <div className="pleros-card" style={{ marginTop: 24, padding: 16 }}>
              <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--c-heading)' }}>Counter-offers</h2>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                {offers.map((o) => (
                  <li
                    key={o.id}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid var(--c-border)',
                    }}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>
                        {o.offeredBy === 'BUYER' ? 'Your offer' : 'Admin counter'} ·{' '}
                        <StatusBadge status={o.status} />
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--c-text-3)' }}>
                        {new Date(o.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {o.notes ? (
                      <p style={{ fontSize: 13, color: 'var(--c-text-3)', marginTop: 8 }}>{o.notes}</p>
                    ) : null}
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--c-text-2)' }}>
                      {o.lines.map((ln) => (
                        <li key={ln.lineNo}>
                          Line {ln.lineNo}: {ln.qty} × ${Number(ln.unitPrice).toFixed(2)}
                        </li>
                      ))}
                    </ul>
                    {canAcceptOffer(q, o) ? (
                      <button
                        type="button"
                        className="btn-primary"
                        style={{ marginTop: 10, fontSize: 13 }}
                        disabled={busy}
                        onClick={() => void acceptOffer(o.id)}
                      >
                        Accept counter
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h2 style={{ fontSize: 16, marginTop: 28, marginBottom: 12, color: 'var(--c-heading)' }}>Lines</h2>
          <table className="pleros-shop-table">
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
              {q.lines.map((ln) => (
                <tr key={ln.id}>
                  <td>{ln.lineNo}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{ln.skuCode ?? '—'}</td>
                  <td>{ln.description}</td>
                  <td>{ln.qty}</td>
                  <td>${Number(ln.unitPrice).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {q && draft ? (
        <PlerosDialogModal
          open={editOpen}
          onOpenChange={(open) => (open ? setEditOpen(true) : requestCloseEdit())}
          title="Edit quote"
          maxWidthClass="max-w-2xl"
          footer={
            confirmDiscard ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
                <span style={{ fontSize: 13, flex: 1 }}>Discard your unsaved changes?</span>
                <button type="button" className="btn-ghost" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    setConfirmDiscard(false)
                    setDirty(false)
                    setEditOpen(false)
                  }}
                >
                  Discard changes
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-ghost" disabled={busy} onClick={requestCloseEdit}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void saveEdit()}>
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            )
          }
        >
          {actions?.editWarning ? (
            <p className="pleros-shop-muted" role="note" style={{ fontSize: 13, marginTop: 0 }}>
              {actions.editWarning}
            </p>
          ) : null}
          {editErr ? (
            <div className="pleros-shop-error" role="alert" style={{ fontSize: 13, marginBottom: 12 }}>
              {editErr.message}
              {editErr.kind === 'conflict' ? (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void reloadLatestForEdit()}>
                    Reload latest version
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <label style={{ display: 'block', fontSize: 13 }}>
            Notes
            <textarea
              rows={3}
              maxLength={MAX_NOTES}
              className="pleros-shop-field"
              style={{ resize: 'vertical' }}
              value={draft.notes}
              disabled={busy}
              onChange={(e) => changeDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 15, color: 'var(--c-heading)' }}>Lines</h3>
            <QuoteLinesEditor
              lines={draft.lines}
              onChange={(lines) => changeDraft({ ...draft, lines })}
              disabled={busy}
              listId="quote-edit-sku-options"
            />
          </div>
        </PlerosDialogModal>
      ) : null}

      {q ? (
        <PlerosDialogModal
          open={withdrawOpen}
          onOpenChange={(open) => {
            if (!open && busy) return
            setWithdrawOpen(open)
          }}
          title="Withdraw this quote?"
          maxWidthClass="max-w-md"
          footer={
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setWithdrawOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void confirmWithdraw()}>
                {busy ? 'Withdrawing…' : 'Withdraw quote'}
              </button>
            </div>
          }
        >
          <p style={{ fontSize: 14, marginTop: 0, marginBottom: 12 }}>
            Withdrawing tells us you no longer want this quote. It can&apos;t be approved, edited or turned into an
            order afterwards. It is not deleted: it stays in your quote list with its lines and counter-offers.
          </p>
          {withdrawErr ? (
            <div className="pleros-shop-error" role="alert" style={{ fontSize: 13, marginBottom: 12 }}>
              {withdrawErr.message}
              {withdrawErr.kind === 'conflict' ? (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void reloadAfterWithdrawConflict()}>
                    Reload latest version
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <label style={{ display: 'block', fontSize: 13 }}>
            Reason (optional)
            <textarea
              rows={3}
              maxLength={MAX_WITHDRAW_REASON}
              className="pleros-shop-field"
              style={{ resize: 'vertical' }}
              value={withdrawReason}
              disabled={busy}
              onChange={(e) => setWithdrawReason(e.target.value)}
            />
          </label>
        </PlerosDialogModal>
      ) : null}

      {counterOpen && q ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => setCounterOpen(false)}
        >
          <div className="pleros-card max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, color: 'var(--c-heading)' }}>Propose counter-offer</h3>
            <p style={{ fontSize: 13, color: 'var(--c-text-3)' }}>Adjust quantities or unit prices per line.</p>
            <textarea
              className="pleros-input min-h-[60px] mt-3"
              placeholder="Notes (optional)"
              value={counterNotes}
              onChange={(e) => setCounterNotes(e.target.value)}
            />
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 16, display: 'grid', gap: 10 }}>
              {q.lines.map((ln) => (
                <li key={ln.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{ln.description}</span>
                  <input
                    type="number"
                    className="pleros-input"
                    style={{ width: 64 }}
                    value={counterLines[ln.lineNo]?.qty ?? ''}
                    onChange={(e) =>
                      setCounterLines((prev) => ({
                        ...prev,
                        [ln.lineNo]: { ...prev[ln.lineNo], qty: e.target.value, unitPrice: prev[ln.lineNo]?.unitPrice ?? String(ln.unitPrice) },
                      }))
                    }
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="pleros-input"
                    style={{ width: 88 }}
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
            <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => setCounterOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void submitCounter()}>
                {busy ? 'Sending…' : 'Submit counter'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}
