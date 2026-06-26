import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'

type NotificationRow = {
  id: string
  channel: string
  recipient: string
  templateKey: string
  status: string
  errorMessage?: string | null
  createdAt: string
}

export default function NotificationsPage() {
  const q = useQuery<NotificationRow[]>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications'),
    refetchInterval: 60_000,
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-pleros-white">Notifications</h1>
        <p className="text-pleros-muted text-sm mt-1">
          Delivery log for email/SMS/push — console in dev, optional webhook via NOTIFICATION_WEBHOOK_URL.
        </p>
      </div>

      <Card>
        <CardTitle>Activity log</CardTitle>
        {q.isLoading ? (
          <p className="text-sm text-pleros-muted mt-3">Loading…</p>
        ) : q.isError ? (
          <p className="text-sm text-red-400 mt-3">Could not load notifications.</p>
        ) : (q.data?.length ?? 0) === 0 ? (
          <div className="mt-2">
            <EmptyState
              icon="🔔"
              title="No notifications yet"
              description="Events that enqueue notifications will appear here after the platform sends or stubs delivery."
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-pleros-muted border-b border-pleros-border">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Channel</th>
                  <th className="pb-2 pr-4">Template</th>
                  <th className="pb-2 pr-4">Recipient</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Error</th>
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((n) => (
                  <tr key={n.id} className="border-b border-pleros-border/60">
                    <td className="py-2 pr-4 text-pleros-muted whitespace-nowrap text-xs">
                      {new Date(n.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={n.channel} />
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-pleros-text">{n.templateKey}</td>
                    <td className="py-2 pr-4 text-pleros-text max-w-[180px] truncate" title={n.recipient}>
                      {n.recipient}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={n.status} />
                    </td>
                    <td className="py-2 text-xs text-red-400 max-w-xs truncate" title={n.errorMessage ?? ''}>
                      {n.errorMessage ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-pleros-muted">
        System sends use <span className="font-mono">POST /notifications/send</span> with an optional{' '}
        <span className="font-mono">Idempotency-Key</span> header.
      </p>
    </div>
  )
}
