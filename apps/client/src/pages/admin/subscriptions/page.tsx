import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { Card, CardTitle } from '@pleros/ui'
import { StatusBadge } from '@/components/pleros/status-badge'

type Subscription = {
  id: string
  customerId: string
  status: string
  interval: string
  nextOrderDate: string
  lastFailureReason?: string | null
  lines: Array<{ skuId: string; quantity: number }>
}

export default function AdminSubscriptionsPage() {
  const qc = useQueryClient()
  const q = useQuery<Subscription[]>({
    queryKey: ['admin-subscriptions'],
    queryFn: () => api.get('/subscriptions'),
  })

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${encodeURIComponent(id)}/retry`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-subscriptions'] }),
  })

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${encodeURIComponent(id)}/cancel`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-subscriptions'] }),
  })

  const runJob = useMutation({
    mutationFn: () => api.post('/internal/subscriptions/process-due', {}),
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white">Subscriptions</h1>
          <p className="text-pleros-muted text-sm mt-1">Subscribe & save across all customers.</p>
        </div>
        <button type="button" className="btn-ghost" disabled={runJob.isPending} onClick={() => runJob.mutate()}>
          {runJob.isPending ? 'Running…' : 'Process due subscriptions'}
        </button>
      </div>

      {runJob.data ? (
        <p className="text-sm text-emerald-400">
          Processed {(runJob.data as { processed?: number }).processed ?? 0}, failed{' '}
          {(runJob.data as { failed?: number }).failed ?? 0}
        </p>
      ) : null}

      <Card>
        <CardTitle>All subscriptions</CardTitle>
        <div className="mt-4 space-y-3">
          {(q.data ?? []).map((s) => (
            <div key={s.id} className="border-b border-pleros-border/60 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={s.status} />
                <span className="text-sm text-pleros-white font-mono">{s.id.slice(-8)}</span>
                <span className="text-xs text-pleros-muted">Customer {s.customerId.slice(-8)}</span>
              </div>
              <p className="text-xs text-pleros-text-3 mt-1">
                {s.interval} · Next {new Date(s.nextOrderDate).toLocaleDateString()} · {s.lines.length} line(s)
              </p>
              {s.lastFailureReason ? <p className="text-xs text-red-400 mt-1">{s.lastFailureReason}</p> : null}
              <div className="flex gap-2 mt-2">
                {s.status === 'PAUSED' ? (
                  <button type="button" className="btn-ghost !text-xs" onClick={() => retry.mutate(s.id)}>
                    Retry
                  </button>
                ) : null}
                {s.status !== 'CANCELLED' ? (
                  <button type="button" className="btn-ghost !text-xs" onClick={() => cancel.mutate(s.id)}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
