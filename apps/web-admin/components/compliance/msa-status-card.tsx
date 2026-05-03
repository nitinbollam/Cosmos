'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'

interface MSAReportRow {
  id: string
  manufacturerDid: string
  weekEnding: string
  status: string
  submittedAt?: string | null
}

export function MSAStatusCard() {
  const { data, isLoading, isError, error } = useQuery<MSAReportRow[]>({
    queryKey: ['msa', 'recent'],
    queryFn: () => api.get('/msa/reports'),
    refetchInterval: 30_000,
  })

  const latest = data?.[0]
  const nextRun = useMemo(() => {
    if (!latest?.weekEnding) return null
    const d = new Date(latest.weekEnding)
    d.setUTCDate(d.getUTCDate() + 7)
    return d.toISOString().slice(0, 10)
  }, [latest?.weekEnding])

  return (
    <div className="cosmos-card">
      <CardTitle>MSA status</CardTitle>

      {isLoading ? (
        <div className="mt-4 space-y-2">
          <div className="skeleton h-8 w-full" />
          <div className="skeleton h-8 w-3/4" />
        </div>
      ) : isError ? (
        <p className="mt-4 text-sm" style={{ color: 'var(--c-danger)' }}>
          {error instanceof Error ? error.message : 'Could not load MSA data'}
        </p>
      ) : !latest ? (
        <div className="mt-2">
          <EmptyState
            icon="✅"
            title="No MSA reports"
            description="Generate a report from the Compliance page when you are ready."
          />
        </div>
      ) : (
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt style={{ color: 'var(--c-text-3)' }}>Last report week</dt>
            <dd className="font-mono" style={{ color: 'var(--c-text)' }}>
              {new Date(latest.weekEnding).toLocaleDateString()}
            </dd>
          </div>
          <div className="flex justify-between gap-4 items-center">
            <dt style={{ color: 'var(--c-text-3)' }}>Status</dt>
            <dd>
              <StatusBadge status={latest.status} />
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt style={{ color: 'var(--c-text-3)' }}>Manufacturer DID</dt>
            <dd className="font-mono text-xs truncate max-w-[160px]" style={{ color: 'var(--c-text-2)' }}>
              {latest.manufacturerDid}
            </dd>
          </div>
          {latest.submittedAt && (
            <div className="flex justify-between gap-4">
              <dt style={{ color: 'var(--c-text-3)' }}>Submitted</dt>
              <dd style={{ color: 'var(--c-text-2)' }}>{new Date(latest.submittedAt).toLocaleString()}</dd>
            </div>
          )}
          {nextRun && (
            <div className="flex justify-between gap-4">
              <dt style={{ color: 'var(--c-text-3)' }}>Next run (est.)</dt>
              <dd className="font-mono" style={{ color: 'var(--c-accent)' }}>
                {nextRun}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}
