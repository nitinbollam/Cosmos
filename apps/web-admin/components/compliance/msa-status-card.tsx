'use client'
import { useQuery } from '@tanstack/react-query'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'

interface MSAReportRow {
  id: string
  manufacturerDid: string
  weekEnding: string
  status: string
}

export function MSAStatusCard() {
  const { data } = useQuery<MSAReportRow[]>({
    queryKey: ['msa', 'recent'],
    queryFn: () => api.get('/msa/reports'),
  })
  const recent = (data ?? []).slice(0, 5)
  return (
    <Card>
      <CardTitle>MSA reporting</CardTitle>
      {recent.length === 0 ? (
        <div className="text-cosmos-muted text-sm mt-2">No reports yet</div>
      ) : (
        <ul className="mt-2 space-y-1">
          {recent.map((r) => (
            <li key={r.id} className="text-sm flex justify-between">
              <span className="text-cosmos-text font-mono">{r.manufacturerDid}</span>
              <span
                className={
                  r.status === 'SUBMITTED'
                    ? 'text-emerald-400'
                    : r.status === 'SUBMISSION_FAILED'
                      ? 'text-cosmos-danger'
                      : 'text-cosmos-warning'
                }
              >
                {r.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
