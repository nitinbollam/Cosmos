import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { formatAmount } from '@/lib/decimal-amount'
import { REQUISITION_STATUSES, hasClientPermission, requisitionTotals, type Requisition, type RequisitionStatus } from '@/lib/requisitions'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { useUserNames, useViewer } from '@/components/purchasing/use-viewer'

export default function RequisitionsPage() {
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? '') as '' | RequisitionStatus
  const mine = params.get('mine') === '1'
  const { viewer } = useViewer()
  const nameOf = useUserNames(viewer)
  const canRead = hasClientPermission(viewer, 'requisitions.read')
  const canWrite = hasClientPermission(viewer, 'requisitions.write')

  const q = useQuery<Requisition[]>({
    queryKey: ['purchase-requisitions', status, mine],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      if (mine) qs.set('mine', '1')
      const s = qs.toString()
      return api.get(`/purchase-requisitions${s ? `?${s}` : ''}`)
    },
    enabled: canRead,
  })

  const setFilter = (next: { status?: string; mine?: boolean }) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (next.status !== undefined) (next.status ? n.set('status', next.status) : n.delete('status'))
      if (next.mine !== undefined) (next.mine ? n.set('mine', '1') : n.delete('mine'))
      return n
    })

  const newButton = canWrite ? (
    <Link to={adminPath('/purchasing/requisitions/new')} className="btn-primary">
      New requisition
    </Link>
  ) : null

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link to={adminPath('/purchasing')} className="text-sm text-pleros-muted hover:text-pleros-white">
          ← Purchasing
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white">Purchase requisitions</h1>
          <p className="text-pleros-muted text-sm mt-1">Requests to buy. A manager other than the requester approves each one before it becomes a PO.</p>
        </div>
        {newButton}
      </div>

      {viewer && !canRead ? (
        <p className="text-sm text-pleros-muted">You don't have access to requisitions. Ask an admin for requisitions access.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center" role="group" aria-label="Filter by status">
            {(['', ...REQUISITION_STATUSES] as const).map((s) => (
              <button
                key={s || 'ALL'}
                type="button"
                aria-pressed={status === s}
                onClick={() => setFilter({ status: s })}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                  status === s ? 'border-pleros-primary bg-pleros-primary/20 text-pleros-white' : 'border-pleros-border text-pleros-muted'
                }`}
              >
                {s ? s.replace(/_/g, ' ') : 'ALL'}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-2 text-xs text-pleros-muted">
              <input type="checkbox" checked={mine} onChange={(e) => setFilter({ mine: e.target.checked })} />
              Only mine
            </label>
          </div>

          <Card>
            <CardTitle>Requisitions</CardTitle>
            {q.isLoading ? (
              <p className="text-sm text-pleros-muted mt-3">Loading…</p>
            ) : q.isError ? (
              <p className="text-sm text-red-400 mt-3" role="alert">
                Could not load requisitions.{' '}
                <button type="button" className="underline" onClick={() => void q.refetch()}>
                  Try again
                </button>
              </p>
            ) : (q.data ?? []).length === 0 ? (
              <EmptyState
                icon="📝"
                title="No requisitions"
                description={status || mine ? 'Nothing matches these filters.' : 'Raise a requisition to ask for approval to buy.'}
                action={newButton ?? undefined}
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-pleros-muted border-b border-pleros-border">
                      <th className="pb-2 pr-4">Number</th>
                      <th className="pb-2 pr-4">Supplier</th>
                      <th className="pb-2 pr-4">Requester</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4 text-right">Total</th>
                      <th className="pb-2 pr-4">Created</th>
                      <th className="pb-2">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(q.data ?? []).map((r) => {
                      const t = requisitionTotals(r)
                      return (
                        <tr key={r.id} className="border-b border-pleros-border/60">
                          <td className="py-2 pr-4 font-mono text-pleros-white">{r.number}</td>
                          <td className="py-2 pr-4 text-pleros-text">{r.supplier?.name ?? '—'}</td>
                          <td className="py-2 pr-4 text-pleros-text">{nameOf(r.requestedBy)}</td>
                          <td className="py-2 pr-4">
                            <StatusBadge status={r.status} />
                          </td>
                          <td className="py-2 pr-4 text-right text-pleros-white whitespace-nowrap">
                            {formatAmount(t.total, r.currency)}
                            {t.unpriced ? <span className="block text-xs text-pleros-muted">{t.unpriced} unpriced</span> : null}
                          </td>
                          <td className="py-2 pr-4 text-pleros-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                          <td className="py-2">
                            <Link to={adminPath(`/purchasing/requisitions/${r.id}`)} className="text-pleros-primary text-xs">
                              View <span className="sr-only">{r.number}</span>
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
