import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { EmptyState } from '@/components/pleros/empty-state'
import { LaborMetrics } from '../types'

interface LaborTabProps {
  userLabel: Map<string, string>
}

export function LaborTab({ userLabel }: LaborTabProps) {
  const laborQ = useQuery({
    queryKey: ['wms-labor-metrics'],
    queryFn: () => api.get<LaborMetrics>('/wms/labor/metrics?days=7'),
  })

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>
        Warehouse productivity for the last 7 days (picks, receives, putaways, packs).
      </p>
      <div className="pleros-card overflow-x-auto">
        {laborQ.isLoading ? (
          <div className="skeleton h-24 w-full" />
        ) : (laborQ.data?.byUser ?? []).length === 0 ? (
          <EmptyState icon="📊" title="No labor events" description="Pick, receive, and putaway activity will appear here." />
        ) : (
          <table className="pleros-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Picks</th>
                <th>Receives</th>
                <th>Putaways</th>
                <th>Packs</th>
              </tr>
            </thead>
            <tbody>
              {(laborQ.data?.byUser ?? []).map((row) => (
                <tr key={row.userId}>
                  <td className="text-sm">{userLabel.get(row.userId) ?? row.userId.slice(-8)}</td>
                  <td>{row.picks}</td>
                  <td>{row.receives}</td>
                  <td>{row.putaways}</td>
                  <td>{row.packs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
