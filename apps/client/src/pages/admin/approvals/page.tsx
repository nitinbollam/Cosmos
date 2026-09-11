import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'

type ApprovalRequest = {
  id: string
  type: string
  subjectId: string
  requestedBy: string
  context: Record<string, unknown>
  status: string
  rejectReason?: string | null
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

  const decide = useMutation({
    mutationFn: ({ id, approve, rejectReason: reason }: { id: string; approve: boolean; rejectReason?: string }) =>
      api.post(`/approvals/${encodeURIComponent(id)}/decide`, { approve, rejectReason: reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] })
      void qc.invalidateQueries({ queryKey: ['purchase-order'] })
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      setRejectId(null)
      setRejectReason('')
    },
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white">Approvals</h1>
        <p className="text-pleros-muted text-sm mt-1">
          Purchase orders over threshold, high discounts, and credit-limit overrides awaiting manager decision.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select className="pleros-input !w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="PURCHASE_ORDER">Purchase orders</option>
          <option value="DISCOUNT">Discounts</option>
          <option value="CREDIT_LIMIT_OVERRIDE">Credit limit</option>
        </select>
        <select className="pleros-input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
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
                      {row.type === 'CREDIT_LIMIT_OVERRIDE' ? (
                        <Link
                          to={`/admin/orders/${encodeURIComponent(row.subjectId)}`}
                          className="block text-xs text-pleros-accent mt-1"
                        >
                          View order →
                        </Link>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge status={row.status} />
                      {row.rejectReason ? (
                        <p className="text-xs text-red-400 mt-1 max-w-xs">{row.rejectReason}</p>
                      ) : null}
                    </td>
                    <td className="py-3">
                      {row.status === 'PENDING' ? (
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
                              <button type="button" className="btn-ghost !text-xs !py-1" onClick={() => setRejectId(null)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-primary !text-xs !py-1"
                              disabled={decide.isPending}
                              onClick={() => decide.mutate({ id: row.id, approve: true })}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn-ghost !text-xs !py-1"
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
                      {decide.isError && rejectId === row.id ? (
                        <p className="text-xs text-red-400 mt-1">{errMsg(decide.error)}</p>
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
