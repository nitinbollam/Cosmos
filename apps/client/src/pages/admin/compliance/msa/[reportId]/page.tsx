import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/cosmos/status-badge'

type MsaReport = {
  id: string
  manufacturerDid: string
  reporterDid: string
  weekStart: string
  weekEnding: string
  totalTransactions: number
  netPurchases: string | number
  status: string
  submittedAt?: string | null
  submissionConfirmation?: string | null
  submissionError?: string | null
  filePath: string
  fileHash: string
  createdAt: string
  updatedAt: string
}

export default function MsaReportDetailPage() {
  const params = useParams()
  const reportId =
    typeof params.reportId === 'string' ? params.reportId : params.reportId?.[0] ?? ''

  const q = useQuery<MsaReport | null>({
    queryKey: ['msa', 'report', reportId],
    queryFn: async () => {
      const row = await api.get<MsaReport | null>(`/msa/reports/${encodeURIComponent(reportId)}`)
      return row
    },
    enabled: !!reportId,
  })

  if (!reportId) return null

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/admin/compliance" className="text-sm text-cosmos-muted hover:text-cosmos-white">
          ← Compliance
        </Link>
      </div>

      {q.isLoading ? (
        <p className="text-cosmos-muted">Loading…</p>
      ) : q.error || !q.data ? (
        <p className="text-red-400">Report not found</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-cosmos-white">MSA report</h1>
              <p className="font-mono text-xs text-cosmos-muted mt-1">{q.data.id}</p>
              <div className="mt-2">
                <StatusBadge status={q.data.status} />
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardTitle>Period</CardTitle>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-muted">Week start</dt>
                  <dd className="text-cosmos-text">{new Date(q.data.weekStart).toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-muted">Week end</dt>
                  <dd className="text-cosmos-text">{new Date(q.data.weekEnding).toLocaleString()}</dd>
                </div>
              </dl>
            </Card>
            <Card>
              <CardTitle>Totals</CardTitle>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-muted">Transactions</dt>
                  <dd className="text-cosmos-white">{q.data.totalTransactions}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-cosmos-muted">Net purchases</dt>
                  <dd className="font-mono text-cosmos-text">
                    ${Number(q.data.netPurchases ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </dd>
                </div>
              </dl>
            </Card>
          </div>

          <Card>
            <CardTitle>Identifiers</CardTitle>
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-cosmos-muted">Manufacturer DID</dt>
                <dd className="font-mono text-xs text-cosmos-text break-all mt-1">{q.data.manufacturerDid}</dd>
              </div>
              <div>
                <dt className="text-cosmos-muted">Reporter DID</dt>
                <dd className="font-mono text-xs text-cosmos-text break-all mt-1">{q.data.reporterDid}</dd>
              </div>
              <div>
                <dt className="text-cosmos-muted">File</dt>
                <dd className="font-mono text-xs text-cosmos-muted break-all mt-1">{q.data.filePath}</dd>
              </div>
              <div>
                <dt className="text-cosmos-muted">Hash</dt>
                <dd className="font-mono text-xs text-cosmos-muted break-all mt-1">{q.data.fileHash}</dd>
              </div>
            </dl>
          </Card>

          {(q.data.submittedAt || q.data.submissionConfirmation || q.data.submissionError) && (
            <Card>
              <CardTitle>Submission</CardTitle>
              <dl className="mt-4 space-y-2 text-sm">
                {q.data.submittedAt && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-cosmos-muted">Submitted at</dt>
                    <dd className="text-cosmos-text">{new Date(q.data.submittedAt).toLocaleString()}</dd>
                  </div>
                )}
                {q.data.submissionConfirmation && (
                  <div>
                    <dt className="text-cosmos-muted">Confirmation</dt>
                    <dd className="text-cosmos-text text-xs mt-1 whitespace-pre-wrap">
                      {q.data.submissionConfirmation}
                    </dd>
                  </div>
                )}
                {q.data.submissionError && (
                  <div>
                    <dt className="text-red-400">Error</dt>
                    <dd className="text-xs mt-1 whitespace-pre-wrap" style={{ color: 'var(--c-danger)' }}>{q.data.submissionError}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
