import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { adminPath } from '@/lib/admin-path'
import { formatAmount } from '@/lib/decimal-amount'
import { APPROVER_ROLES, apiFailure } from '@/lib/requisitions'

type ApprovalRequest = {
  id: string
  type: string
  subjectId: string
  requestedBy: string
  context: Record<string, unknown>
  status: string
  rejectReason?: string | null
  cancelReason?: string | null
  createdAt: string
}

function contextSummary(type: string, ctx: Record<string, unknown>): string {
  if (type === 'PURCHASE_ORDER') {
    const total = ctx.total != null ? `$${Number(ctx.total).toFixed(2)}` : '—'
    return `PO ${String(ctx.number ?? '')} · ${total}`
  }
  if (type === 'DISCOUNT') {
    return `Code ${String(ctx.code ?? '')} · ${Number(ctx.effectivePct ?? 0).toFixed(1)}% off`
  }
  if (type === 'CREDIT_LIMIT_OVERRIDE') {
    return `Customer · projected $${Number(ctx.projectedTotal ?? 0).toFixed(2)} / limit $${Number(ctx.creditLimit ?? 0).toFixed(2)}`
  }
  if (type === 'PURCHASE_REQUISITION') {
    const total = ctx.total != null ? formatAmount(String(ctx.total), typeof ctx.currency === 'string' ? ctx.currency : 'USD') : '—'
    const lines = typeof ctx.lineCount === 'number' ? ` · ${ctx.lineCount} line(s)` : ''
    const supplier = typeof ctx.supplierName === 'string' ? ` · ${ctx.supplierName}` : ''
    return `Requisition ${String(ctx.number ?? '')} · ${total}${supplier}${lines}`
  }
  if (type === 'EXPENSE_REPORT') {
    const lines = Array.isArray(ctx.lines) ? ctx.lines : []
    return `Expense report · $${Number(ctx.total ?? 0).toFixed(2)} · ${lines.length} line(s)`
  }
  return JSON.stringify(ctx)
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

export default function ApprovalsPage() {
  const qc = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const q = useQuery<ApprovalRequest[]>({
    queryKey: ['approvals', typeFilter, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (typeFilter) params.set('type', typeFilter)
      if (statusFilter) params.set('status', statusFilter)
      const qs = params.toString()
      return api.get(`/approvals${qs ? `?${qs}` : ''}`)
    },
  })

  // Shared with the sidebar's query, so this costs no extra request.
  const { data: me } = useQuery({ queryKey: ['auth-me'], queryFn: () => api.get<{ userId?: string; role?: string }>('/auth/me') })
  // The decide endpoint is gated by role, not permission: only these roles see Approve / Reject.
  const isApprover = APPROVER_ROLES.includes(me?.role ?? '')

  const decide = useMutation({
    mutationFn: ({ id, approve, rejectReason: reason }: { id: string; approve: boolean; rejectReason?: string }) => {
      setDecidingId(id)
      return api.post(`/approvals/${encodeURIComponent(id)}/decide`, { approve, rejectReason: reason })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] })
      void qc.invalidateQueries({ queryKey: ['purchase-order'] })
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      void qc.invalidateQueries({ queryKey: ['purchase-requisition'] })
      void qc.invalidateQueries({ queryKey: ['purchase-requisitions'] })
      setRejectId(null)
      setRejectReason('')
    },
    onError: (e) => {
      // Already decided, withdrawn or cancelled meanwhile: show the inbox as it is now.
      const { status } = apiFailure(e)
      if (status === 400 || status === 409) void qc.invalidateQueries({ queryKey: ['approvals'] })
    },
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white">Approvals</h1>
        <p className="text-pleros-muted text-sm mt-1">
          Purchase requisitions, purchase orders over threshold, high discounts, and credit-limit overrides awaiting manager decision.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="pleros-input !w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="PURCHASE_REQUISITION">Purchase requisitions</option>
          <option value="PURCHASE_ORDER">Purchase orders</option>
          <option value="DISCOUNT">Discounts</option>
          <option value="CREDIT_LIMIT_OVERRIDE">Credit limit</option>
          <option value="EXPENSE_REPORT">Expense reports</option>
        </select>
        <select className="pleros-input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled (closed without a decision)</option>
          <option value="">All statuses</option>
        </select>
      </div>

      <Card>
        <CardTitle>Inbox</CardTitle>
        {q.isLoading ? (
          <p className="text-sm text-pleros-muted mt-3">Loading…</p>
        ) : q.isError ? (
          <p className="text-sm text-red-400 mt-3">Could not load approvals.</p>
        ) : (q.data?.length ?? 0) === 0 ? (
          <div className="mt-2">
            <EmptyState icon="✓" title="No approval requests" description="Nothing matches your filters." />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-pleros-muted border-b border-pleros-border">
                  <th className="pb-2 pr-4">Age</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Summary</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-pleros-border/60 align-top">
                    <td className="py-3 pr-4 text-pleros-muted whitespace-nowrap text-xs">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={row.type} />
                    </td>
                    <td className="py-3 pr-4 text-pleros-text">
                      {contextSummary(row.type, row.context ?? {})}
                      {row.type === 'PURCHASE_ORDER' ? (
                        <Link
                          to={`/admin/purchasing/${encodeURIComponent(row.subjectId)}`}
                          className="block text-xs text-pleros-accent mt-1"
                        >
                          View PO →
                        </Link>
                      ) : null}
                      {row.type === 'PURCHASE_REQUISITION' ? (
                        <Link
                          to={adminPath(`/purchasing/requisitions/${encodeURIComponent(row.subjectId)}`)}
                          className="block text-xs text-pleros-accent mt-1"
                        >
                          View requisition →
                        </Link>
                      ) : null}
                      {row.type === 'CREDIT_LIMIT_OVERRIDE' ? (
                        <Link
                          to={`/admin/orders/${encodeURIComponent(row.subjectId)}`}
                          className="block text-xs text-pleros-accent mt-1"
                        >
                          View order →
                        </Link>
                      ) : null}
                      {row.type === 'EXPENSE_REPORT' && Array.isArray(row.context?.lines) ? (
                        <ul className="text-xs text-pleros-muted mt-2 space-y-1 max-w-md">
                          {(row.context.lines as Array<{ category?: string; amount?: number; description?: string; receiptUrl?: string | null }>).map(
                            (line, i) => (
                              <li key={i} className="flex items-center justify-between gap-2">
                                <span>
                                  {line.category} · ${Number(line.amount ?? 0).toFixed(2)} · {line.description}
                                </span>
                                {line.receiptUrl ? (
                                  <a
                                    href={line.receiptUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-pleros-accent hover:underline flex-shrink-0"
                                  >
                                    Receipt ↗
                                  </a>
                                ) : null}
                              </li>
                            ),
                          )}
                        </ul>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={row.status} />
                      {row.rejectReason ? (
                        <p className="text-xs text-red-400 mt-1 max-w-xs">{row.rejectReason}</p>
                      ) : null}
                      {row.status === 'CANCELLED' && row.cancelReason ? (
                        <p className="text-xs text-pleros-muted mt-1 max-w-xs">{row.cancelReason}</p>
                      ) : null}
                    </td>
                    <td className="py-3">
                      {row.status === 'PENDING' && !isApprover ? (
                        <span className="text-xs text-pleros-text-3">A manager or admin decides</span>
                      ) : row.status === 'PENDING' && row.type === 'PURCHASE_REQUISITION' && row.requestedBy === me?.userId ? (
                        <span className="text-xs text-pleros-text-3">
                          Your requisition: another manager or admin decides. To change it,{' '}
                          <Link to={adminPath(`/purchasing/requisitions/${encodeURIComponent(row.subjectId)}`)} className="text-pleros-accent">
                            withdraw it
                          </Link>
                          .
                        </span>
                      ) : row.status === 'PENDING' ? (
                        rejectId === row.id ? (
                          <div className="space-y-2 min-w-[200px]">
                            <input
                              className="pleros-input w-full"
                              placeholder="Reject reason (required)"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="btn-primary !text-xs !py-1"
                                disabled={!rejectReason.trim() || decide.isPending}
                                onClick={() =>
                                  decide.mutate({ id: row.id, approve: false, rejectReason: rejectReason.trim() })
                                }
                              >
                                Confirm reject
                              </button>
                              <button type="button" className="btn-ghost !text-xs !py-1" disabled={decide.isPending} onClick={() => setRejectId(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {row.requestedBy === me?.userId ? (
                              <span className="text-xs text-pleros-text-3 self-center">Your request: another approver decides</span>
                            ) : (
                              <button
                                type="button"
                                className="btn-primary !text-xs !py-1"
                                disabled={decide.isPending}
                                onClick={() => decide.mutate({ id: row.id, approve: true })}
                              >
                                Approve
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-ghost !text-xs !py-1"
                              disabled={decide.isPending}
                              onClick={() => {
                                setRejectId(row.id)
                                setRejectReason('')
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        )
                      ) : (
                        '—'
                      )}
                      {decide.isError && decidingId === row.id ? (
                        <p className="text-xs text-red-400 mt-1" role="alert">
                          {errMsg(decide.error)}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
