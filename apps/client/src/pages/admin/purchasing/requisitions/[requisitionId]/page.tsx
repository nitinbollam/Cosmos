import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { showToast } from '@/lib/toast'
import { formatAmount, lineAmount } from '@/lib/decimal-amount'
import { STATUS_HELP, apiFailure, requisitionActions, requisitionTotals, type Requisition } from '@/lib/requisitions'
import { StatusBadge } from '@/components/pleros/status-badge'
import { RequisitionForm, type RequisitionPayload } from '@/components/purchasing/requisition-form'
import { useUserNames, useViewer } from '@/components/purchasing/use-viewer'

type Panel = null | 'withdraw' | 'cancel' | 'convert' | 'reject'

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')

export default function RequisitionDetailPage() {
  const params = useParams()
  const id = typeof params.requisitionId === 'string' ? params.requisitionId : ''
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { viewer } = useViewer()
  const nameOf = useUserNames(viewer)
  const [editing, setEditing] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [notice, setNotice] = useState<{ kind: 'error' | 'stale'; text: string } | null>(null)

  const q = useQuery<Requisition>({
    queryKey: ['purchase-requisition', id],
    queryFn: () => api.get(`/purchase-requisitions/${encodeURIComponent(id)}`),
    enabled: !!id,
  })
  const suppliers = useQuery<Array<{ id: string; name: string; code: string }>>({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers'),
    enabled: editing,
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['purchase-requisition', id] })
    void qc.invalidateQueries({ queryKey: ['purchase-requisitions'] })
    void qc.invalidateQueries({ queryKey: ['approvals'] })
  }

  /** One handler for every action: 409/404 means the record moved on, so reload it and say so. */
  const onFailure = (e: unknown) => {
    const { status, message } = apiFailure(e)
    if (status === 409 || status === 404) {
      setNotice({ kind: 'stale', text: `${message}. The requisition has been reloaded with its current state.` })
      setEditing(false)
      setPanel(null)
      refresh()
    } else {
      setNotice({ kind: 'error', text: message })
    }
  }
  const succeed = (msg: string) => {
    setNotice(null)
    setPanel(null)
    showToast(msg, 'success')
    refresh()
  }

  const save = useMutation({
    mutationFn: (body: RequisitionPayload) => api.patch<Requisition>(`/purchase-requisitions/${encodeURIComponent(id)}`, body),
    onSuccess: () => {
      setEditing(false)
      succeed('Changes saved')
    },
    onError: onFailure,
  })
  const act = useMutation({
    mutationFn: ({ action, body }: { action: 'submit' | 'withdraw' | 'cancel'; body?: unknown }) =>
      api.post<Requisition>(`/purchase-requisitions/${encodeURIComponent(id)}/${action}`, body ?? {}),
    onSuccess: (_r, v) =>
      succeed(v.action === 'submit' ? 'Submitted for approval' : v.action === 'withdraw' ? 'Withdrawn: it is a draft again' : 'Requisition cancelled'),
    onError: onFailure,
  })
  const decide = useMutation({
    mutationFn: ({ approvalId, ...body }: { approvalId: string; approve: boolean; rejectReason?: string }) =>
      api.post(`/approvals/${encodeURIComponent(approvalId)}/decide`, body),
    onSuccess: (_r, v) => succeed(v.approve ? 'Approved' : 'Rejected'),
    onError: async (e, v) => {
      // The shared decide endpoint answers 400 both for a request that is no longer pending (withdrawn, cancelled or
      // decided in another session) and for invalid input. Re-read the requisition to tell them apart.
      const { status, message } = apiFailure(e)
      if (status !== 400) return onFailure(e)
      const fresh = (await q.refetch()).data
      const stillPending =
        fresh?.status === 'PENDING_APPROVAL' && fresh.approvalRequest?.id === v.approvalId && fresh.approvalRequest.status === 'PENDING'
      if (stillPending) return setNotice({ kind: 'error', text: message })
      setNotice({ kind: 'stale', text: `${message}: this requisition changed in another session. It has been reloaded with its current state.` })
      setPanel(null)
      refresh()
    },
  })
  const convert = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: string }>(`/purchase-requisitions/${encodeURIComponent(id)}/convert`, poNumber.trim() ? { number: poNumber.trim() } : {}),
    onSuccess: (po) => {
      succeed(`Purchase order ${po.number} is ready`)
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      navigate(adminPath(`/purchasing/${po.id}`))
    },
    onError: onFailure,
  })
  const busy = save.isPending || act.isPending || decide.isPending || convert.isPending

  if (q.isLoading) return <p className="p-6 text-pleros-muted">Loading…</p>
  if (q.isError || !q.data) {
    const { status } = apiFailure(q.error)
    return (
      <div className="p-6 space-y-3">
        <Link to={adminPath('/purchasing/requisitions')} className="text-sm text-pleros-muted hover:text-pleros-white">
          ← Requisitions
        </Link>
        <p className="text-red-400" role="alert">
          {status === 404 ? 'Requisition not found' : status === 403 ? "You don't have access to requisitions" : 'Could not load the requisition'}
        </p>
      </div>
    )
  }

  const r = q.data
  const can = requisitionActions(r, viewer)
  const totals = requisitionTotals(r)
  const ar = r.approvalRequest

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link to={adminPath('/purchasing/requisitions')} className="text-sm text-pleros-muted hover:text-pleros-white">
          ← Requisitions
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white">Requisition {r.number}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            {r.revision > 0 ? <span className="text-xs text-pleros-muted">Revision {r.revision}</span> : null}
          </div>
          <p className="text-sm text-pleros-muted mt-2 max-w-xl">{STATUS_HELP[r.status]}</p>
        </div>
        {!editing && (
          <div className="flex flex-wrap gap-2">
            {can.edit && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setNotice(null); setEditing(true) }}>
                Edit
              </button>
            )}
            {can.submit && (
              <button type="button" className="btn-primary" disabled={busy} aria-busy={act.isPending} onClick={() => act.mutate({ action: 'submit' })}>
                {act.isPending && act.variables?.action === 'submit' ? 'Submitting…' : r.status === 'REJECTED' ? 'Resubmit for approval' : 'Submit for approval'}
              </button>
            )}
            {can.decide && (
              <>
                <button type="button" className="btn-primary" disabled={busy} aria-busy={decide.isPending} onClick={() => ar && decide.mutate({ approvalId: ar.id, approve: true })}>
                  {decide.isPending && decide.variables?.approve ? 'Approving…' : 'Approve'}
                </button>
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setRejectReason(''); setPanel('reject') }}>
                  Reject
                </button>
              </>
            )}
            {can.convert && (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => setPanel('convert')}>
                Convert to PO
              </button>
            )}
            {can.openPo && (
              <Link to={adminPath(`/purchasing/${r.purchaseOrderId}`)} className="btn-primary">
                Open purchase order
              </Link>
            )}
            {can.withdraw && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => setPanel('withdraw')}>
                Withdraw for revision
              </button>
            )}
            {can.cancel && (
              <button
                type="button"
                className="btn-ghost"
                style={{ color: 'var(--c-danger)' }}
                disabled={busy}
                onClick={() => { setCancelReason(''); setPanel('cancel') }}
              >
                Cancel requisition
              </button>
            )}
          </div>
        )}
      </div>

      {can.decideBlockedReason && <p className="text-sm text-pleros-muted">{can.decideBlockedReason}</p>}
      {r.syncPending && (
        <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200 flex flex-wrap items-center gap-3">
          <span>Some approval records are still being synchronised. Nothing is lost; this finishes on its own.</span>
          <button type="button" className="underline" onClick={() => void q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? 'Checking…' : 'Check again'}
          </button>
        </div>
      )}
      {notice && (
        <div
          role="alert"
          className={`rounded-md p-3 text-sm ${notice.kind === 'stale' ? 'border border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border border-red-500/40 bg-red-500/10 text-red-300'}`}
        >
          {notice.text}
        </div>
      )}

      {panel && !editing && (
        <Card>
          {panel === 'withdraw' && (
            <ConfirmPanel
              title="Withdraw for revision?"
              body={
                r.status === 'APPROVED'
                  ? 'This throws away the approval. After your changes it must be submitted and approved again.'
                  : 'The pending approval request is closed and the requisition goes back to draft.'
              }
              confirmLabel={act.isPending ? 'Withdrawing…' : 'Withdraw'}
              busy={busy}
              onConfirm={() => act.mutate({ action: 'withdraw' })}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'cancel' && (
            <ConfirmPanel
              title="Cancel this requisition?"
              body="Cancelling is final. Any pending approval request is closed."
              confirmLabel={act.isPending ? 'Cancelling…' : 'Cancel requisition'}
              danger
              busy={busy}
              onConfirm={() => act.mutate({ action: 'cancel', body: { reason: cancelReason.trim() || undefined } })}
              onClose={() => setPanel(null)}
            >
              <label className="block text-xs text-pleros-muted mt-3" htmlFor="cancel-reason">
                Reason (optional)
              </label>
              <input id="cancel-reason" className="pleros-input w-full mt-1" maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </ConfirmPanel>
          )}
          {panel === 'reject' && (
            <ConfirmPanel
              title="Reject this requisition?"
              body="The requester can revise it and submit it again."
              confirmLabel={decide.isPending ? 'Rejecting…' : 'Reject'}
              danger
              busy={busy}
              disabled={!rejectReason.trim()}
              onConfirm={() => ar && decide.mutate({ approvalId: ar.id, approve: false, rejectReason: rejectReason.trim() })}
              onClose={() => setPanel(null)}
            >
              <label className="block text-xs text-pleros-muted mt-3" htmlFor="reject-reason">
                Reason (required)
              </label>
              <input id="reject-reason" className="pleros-input w-full mt-1" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
            </ConfirmPanel>
          )}
          {panel === 'convert' && (
            <ConfirmPanel
              title="Create a purchase order from this requisition?"
              body="The PO copies the approved supplier, currency, lines and cost estimates, and starts as a draft. Submitting it needs no further approval."
              confirmLabel={convert.isPending ? 'Creating PO…' : 'Create PO'}
              busy={busy}
              onConfirm={() => convert.mutate()}
              onClose={() => setPanel(null)}
            >
              <label className="block text-xs text-pleros-muted mt-3" htmlFor="po-number">
                PO number (optional)
              </label>
              <input
                id="po-number"
                className="pleros-input w-full mt-1 font-mono"
                placeholder={`PO-${r.number}`}
                maxLength={64}
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
              />
            </ConfirmPanel>
          )}
        </Card>
      )}

      {editing ? (
        <Card>
          <CardTitle>Edit requisition</CardTitle>
          <div className="mt-4">
            <RequisitionForm
              initial={r}
              suppliers={suppliers.data ?? []}
              suppliersLoading={suppliers.isLoading}
              saving={save.isPending}
              serverError={notice?.kind === 'error' ? notice.text : null}
              saveLabel="Save changes"
              onSave={(payload) => save.mutate(payload)}
              onCancel={() => { setNotice(null); setEditing(false) }}
            />
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardTitle>Details</CardTitle>
              <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-pleros-muted">Requester</dt>
                <dd className="text-pleros-text">{nameOf(r.requestedBy)}</dd>
                <dt className="text-pleros-muted">Supplier</dt>
                <dd className="text-pleros-text">{r.supplier ? `${r.supplier.name} (${r.supplier.code})` : <span className="text-pleros-muted">Not chosen yet</span>}</dd>
                <dt className="text-pleros-muted">Currency</dt>
                <dd className="text-pleros-text">{r.currency}</dd>
                <dt className="text-pleros-muted">Created</dt>
                <dd className="text-pleros-text">{when(r.createdAt)}</dd>
                {r.notes ? (
                  <>
                    <dt className="text-pleros-muted">Notes</dt>
                    <dd className="text-pleros-text whitespace-pre-wrap">{r.notes}</dd>
                  </>
                ) : null}
              </dl>
            </Card>
            <Card>
              <CardTitle>Approval</CardTitle>
              <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-pleros-muted">Submitted</dt>
                <dd className="text-pleros-text">{when(r.submittedAt)}</dd>
                {ar ? (
                  <>
                    <dt className="text-pleros-muted">Request</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={ar.status} />
                      {ar.status === 'PENDING' ? <span className="text-xs text-pleros-muted">Waiting for another manager or admin</span> : null}
                    </dd>
                  </>
                ) : null}
                {r.approvedBy ? (
                  <>
                    <dt className="text-pleros-muted">Approved by</dt>
                    <dd className="text-pleros-text">
                      {nameOf(r.approvedBy)} · {when(r.approvedAt)}
                    </dd>
                  </>
                ) : null}
                {r.rejectedBy ? (
                  <>
                    <dt className="text-pleros-muted">Rejected by</dt>
                    <dd className="text-pleros-text">
                      {nameOf(r.rejectedBy)} · {when(r.rejectedAt)}
                      {r.rejectReason ? <span className="block text-red-300">“{r.rejectReason}”</span> : null}
                    </dd>
                  </>
                ) : null}
                {ar?.status === 'CANCELLED' && ar.cancelReason ? (
                  <>
                    <dt className="text-pleros-muted">Closed</dt>
                    <dd className="text-pleros-text">{ar.cancelReason}</dd>
                  </>
                ) : null}
                {r.status === 'CANCELLED' ? (
                  <>
                    <dt className="text-pleros-muted">Cancelled by</dt>
                    <dd className="text-pleros-text">
                      {nameOf(r.cancelledBy)} · {when(r.cancelledAt)}
                      {r.cancelReason ? <span className="block text-pleros-muted">{r.cancelReason}</span> : null}
                    </dd>
                  </>
                ) : null}
                {r.purchaseOrderId ? (
                  <>
                    <dt className="text-pleros-muted">Purchase order</dt>
                    <dd>
                      <Link to={adminPath(`/purchasing/${r.purchaseOrderId}`)} className="text-pleros-accent">
                        Open the PO →
                      </Link>
                    </dd>
                  </>
                ) : null}
              </dl>
            </Card>
          </div>

          <Card>
            <CardTitle>Lines</CardTitle>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-pleros-muted border-b border-pleros-border">
                    <th className="pb-2 pr-4">#</th>
                    <th className="pb-2 pr-4">SKU</th>
                    <th className="pb-2 pr-4">Description</th>
                    <th className="pb-2 pr-4 text-right">Qty</th>
                    <th className="pb-2 pr-4 text-right">Unit cost</th>
                    <th className="pb-2 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => (
                    <tr key={l.id ?? l.lineNo} className="border-b border-pleros-border/60">
                      <td className="py-2 pr-4 text-pleros-muted">{l.lineNo}</td>
                      <td className="py-2 pr-4 font-mono text-pleros-text">{l.skuCode ?? '—'}</td>
                      <td className="py-2 pr-4 text-pleros-text">{l.description}</td>
                      <td className="py-2 pr-4 text-right text-pleros-white">{l.qtyRequested}</td>
                      <td className="py-2 pr-4 text-right text-pleros-text">{l.unitCost == null ? <span className="text-pleros-muted">No price yet</span> : formatAmount(l.unitCost, r.currency)}</td>
                      <td className="py-2 text-right text-pleros-white">{l.unitCost == null ? '—' : formatAmount(lineAmount(l.unitCost, l.qtyRequested), r.currency)}</td>
                    </tr>
                  ))}
                  {r.lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-3 text-pleros-muted">
                        No lines yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <dl className="mt-4 ml-auto grid grid-cols-2 gap-y-1 max-w-xs text-sm">
              <dt className="text-pleros-muted">Lines</dt>
              <dd className="text-right text-pleros-text">{formatAmount(totals.lines, r.currency)}</dd>
              <dt className="text-pleros-muted">Freight</dt>
              <dd className="text-right text-pleros-text">{formatAmount(r.freightAmount, r.currency)}</dd>
              <dt className="text-pleros-muted">Duty</dt>
              <dd className="text-right text-pleros-text">{formatAmount(r.dutyAmount, r.currency)}</dd>
              <dt className="text-pleros-muted">Other</dt>
              <dd className="text-right text-pleros-text">{formatAmount(r.otherLandedAmount, r.currency)}</dd>
              <dt className="text-pleros-white font-semibold">Total</dt>
              <dd className="text-right text-pleros-white font-semibold">{formatAmount(totals.total, r.currency)}</dd>
            </dl>
            {totals.unpriced ? <p className="text-xs text-pleros-muted mt-2">{totals.unpriced} line(s) have no price yet and count as 0.</p> : null}
          </Card>
        </>
      )}
    </div>
  )
}

function ConfirmPanel(props: {
  title: string
  body: string
  confirmLabel: string
  busy: boolean
  danger?: boolean
  disabled?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: React.ReactNode
}) {
  return (
    <section aria-label={props.title}>
      <h2 className="text-base font-semibold text-pleros-white">{props.title}</h2>
      <p className="text-sm text-pleros-muted mt-1">{props.body}</p>
      {props.children}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          style={props.danger ? { background: 'var(--c-danger)' } : undefined}
          disabled={props.busy || props.disabled}
          aria-busy={props.busy}
          onClick={props.onConfirm}
        >
          {props.confirmLabel}
        </button>
        <button type="button" className="btn-ghost" disabled={props.busy} onClick={props.onClose}>
          Keep it
        </button>
      </div>
    </section>
  )
}
