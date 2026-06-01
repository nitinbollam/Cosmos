import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'
import { SpreadsheetImportPanel } from '@/components/cosmos/spreadsheet-import-panel'
import { rowNumber, rowValue, type BulkImportResult } from '@/lib/spreadsheet-import'

type MsaStatus = 'GENERATED' | 'SUBMITTED' | 'SUBMISSION_FAILED' | 'ACCEPTED'

type MsaReport = {
  id: string
  manufacturerDid: string
  reporterDid: string
  weekStart: string
  weekEnding: string
  totalTransactions: number
  netPurchases: string | number
  status: MsaStatus
  submittedAt?: string | null
  submissionConfirmation?: string | null
  submissionError?: string | null
  filePath: string
  fileHash: string
  createdAt: string
}

type TaxSummary = { totalNet: number | string | null; count: number }

const MSA_FILTERS: Array<{ label: string; value: '' | MsaStatus }> = [
  { label: 'All', value: '' },
  { label: 'Generated', value: 'GENERATED' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Failed', value: 'SUBMISSION_FAILED' },
  { label: 'Accepted', value: 'ACCEPTED' },
]

export default function CompliancePage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'msa' | 'tax'>('msa')
  const [statusFilter, setStatusFilter] = useState<'' | MsaStatus>('')
  const [importOpen, setImportOpen] = useState(false)

  const reports = useQuery<MsaReport[]>({
    queryKey: ['msa', 'reports', statusFilter],
    queryFn: () =>
      statusFilter
        ? api.get(`/msa/reports?status=${encodeURIComponent(statusFilter)}`)
        : api.get('/msa/reports'),
    enabled: tab === 'msa',
    refetchInterval: 120_000,
  })

  const tax = useQuery<TaxSummary>({
    queryKey: ['tax', 'summary'],
    queryFn: () => api.get('/tax/summary'),
    enabled: tab === 'tax',
  })

  const generate = useMutation({
    mutationFn: () => api.post(`/msa/reports/generate?weekOffset=0`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['msa', 'reports'] }),
  })

  const runCron = useMutation({
    mutationFn: () => api.post('/msa/cron?weekOffset=0', {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['msa', 'reports'] }),
  })

  const uploadReport = useMutation({
    mutationFn: (id: string) => api.post(`/msa/reports/${id}/upload`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['msa', 'reports'] }),
  })

  const submitReport = useMutation({
    mutationFn: (id: string) => api.post(`/msa/reports/${id}/submit`, {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['msa', 'reports'] }),
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white">Compliance</h1>
          <p className="text-cosmos-muted text-sm mt-1">MSA reporting and tax exposure from compliance data.</p>
        </div>
        <div className="flex rounded-lg border border-cosmos-border overflow-hidden">
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'msa' ? 'bg-cosmos-primary text-white' : 'text-cosmos-text'}`}
            onClick={() => setTab('msa')}
          >
            MSA
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'tax' ? 'bg-cosmos-primary text-white' : 'text-cosmos-text'}`}
            onClick={() => setTab('tax')}
          >
            Tax
          </button>
        </div>
      </div>

      {tab === 'msa' && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => setImportOpen((open) => !open)}
            >
              {importOpen ? 'Hide transaction import' : 'Import transactions (CSV/Excel)'}
            </button>
            {MSA_FILTERS.map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                  statusFilter === f.value
                    ? 'border-cosmos-primary bg-cosmos-primary/20 text-cosmos-white'
                    : 'border-cosmos-border text-cosmos-muted'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
            >
              {generate.isPending ? 'Generating…' : 'Generate weekly drafts'}
            </button>
            <button
              type="button"
              onClick={() => runCron.mutate()}
              disabled={runCron.isPending}
              className="h-9 px-4 rounded-md border border-cosmos-border text-sm text-cosmos-text disabled:opacity-40"
            >
              {runCron.isPending ? 'Running…' : 'Run full automation'}
            </button>
          </div>
          {(generate.error || runCron.error) && (
            <p className="text-red-400 text-sm">
              {String((generate.error ?? runCron.error as Error)?.message ?? 'MSA action failed')}
            </p>
          )}
          {runCron.data ? (
            <p className="text-xs text-cosmos-muted">
              Automation: {(runCron.data as { generated?: string[] }).generated?.length ?? 0} generated,{' '}
              {(runCron.data as { submitted?: string[] }).submitted?.length ?? 0} submitted via EDI
            </p>
          ) : null}

          {importOpen ? (
            <SpreadsheetImportPanel
              title="Import MSA transactions"
              hint="Load purchase data before generating weekly reports. Dates should be ISO format (YYYY-MM-DD)."
              expectedColumns={[
                'manufacturerDid',
                'upcCode',
                'transactionDate',
                'quantityPurchased',
                'cartonCount',
                'netAmount',
                'returnAmount',
                'isQualifying',
                'orderId',
                'poId',
              ]}
              templateFilename="msa-transactions-import-template.csv"
              onImport={async (rows) => {
                const payload = rows
                  .map((row) => {
                    const manufacturerDid = rowValue(row, 'manufacturerDid', 'manufacturer_did')
                    const upcCode = rowValue(row, 'upcCode', 'upc', 'upc_code')
                    const transactionDate = rowValue(row, 'transactionDate', 'transaction_date', 'date')
                    const quantityPurchased = rowNumber(
                      row,
                      'quantityPurchased',
                      'quantity_purchased',
                      'quantity',
                    )
                    const cartonCount = rowNumber(row, 'cartonCount', 'carton_count', 'cartons')
                    const netAmount = rowNumber(row, 'netAmount', 'net_amount', 'amount')
                    if (
                      !manufacturerDid ||
                      !upcCode ||
                      !transactionDate ||
                      quantityPurchased == null ||
                      cartonCount == null ||
                      netAmount == null
                    ) {
                      return null
                    }
                    const returnAmount = rowNumber(row, 'returnAmount', 'return_amount', 'returns')
                    const qualifyingRaw = rowValue(row, 'isQualifying', 'is_qualifying', 'qualifying').toLowerCase()
                    return {
                      manufacturerDid,
                      upcCode,
                      transactionDate,
                      quantityPurchased: Math.trunc(quantityPurchased),
                      cartonCount: Math.trunc(cartonCount),
                      netAmount,
                      returnAmount,
                      isQualifying:
                        qualifyingRaw === 'false' || qualifyingRaw === '0' || qualifyingRaw === 'no'
                          ? false
                          : qualifyingRaw
                            ? true
                            : undefined,
                      orderId: rowValue(row, 'orderId', 'order_id') || undefined,
                      poId: rowValue(row, 'poId', 'po_id') || undefined,
                    }
                  })
                  .filter((row): row is NonNullable<typeof row> => row != null)
                const result = await api.post<BulkImportResult>('/msa/transactions/import', { rows: payload })
                void qc.invalidateQueries({ queryKey: ['msa', 'reports'] })
                void qc.invalidateQueries({ queryKey: ['tax', 'summary'] })
                return result
              }}
            />
          ) : null}

          <Card>
            <CardTitle>MSA reports</CardTitle>
            {reports.isLoading ? (
              <p className="text-sm text-cosmos-muted mt-3">Loading…</p>
            ) : reports.isError ? (
              <p className="text-sm text-red-400 mt-3">Could not load MSA reports.</p>
            ) : (reports.data ?? []).length === 0 ? (
              <EmptyState
                icon="📋"
                title="No reports yet"
                description="Generate a weekly draft or adjust filters. Underlying MSA transactions must exist for your tenant."
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                      <th className="pb-2 pr-4">Manufacturer DID</th>
                      <th className="pb-2 pr-4">Week ending</th>
                      <th className="pb-2 pr-4">Transactions</th>
                      <th className="pb-2 pr-4">Net purchases</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reports.data ?? []).map((r) => (
                      <tr key={r.id} className="border-b border-cosmos-border/60">
                        <td className="py-2 pr-4 font-mono text-xs text-cosmos-text max-w-[200px] truncate">
                          {r.manufacturerDid}
                        </td>
                        <td className="py-2 pr-4 text-cosmos-muted whitespace-nowrap">
                          {new Date(r.weekEnding).toLocaleDateString()}
                        </td>
                        <td className="py-2 pr-4 text-cosmos-white">{r.totalTransactions}</td>
                        <td className="py-2 pr-4 font-mono text-cosmos-text">
                          ${Number(r.netPurchases ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 pr-4">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            <Link
                              to={adminPath(`/compliance/msa/${r.id}`)}
                              className="text-cosmos-primary text-xs whitespace-nowrap"
                            >
                              View
                            </Link>
                            {r.status === 'GENERATED' ? (
                              <>
                                <button
                                  type="button"
                                  className="text-xs text-cosmos-muted hover:text-cosmos-white"
                                  disabled={uploadReport.isPending}
                                  onClick={() => uploadReport.mutate(r.id)}
                                >
                                  Upload
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-cosmos-muted hover:text-cosmos-white"
                                  disabled={submitReport.isPending}
                                  onClick={() => submitReport.mutate(r.id)}
                                >
                                  Submit EDI
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'tax' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardTitle>MSA transaction rollup</CardTitle>
            <p className="text-xs text-cosmos-muted mt-2">
              Totals <span className="font-mono text-cosmos-text/80">netAmount</span> across qualifying MSA
              transactions for this tenant (not sales tax collected at checkout).
            </p>
            {tax.isLoading ? (
              <p className="text-sm text-cosmos-muted mt-4">Loading…</p>
            ) : tax.isError ? (
              <p className="text-sm text-red-400 mt-4">Could not load summary.</p>
            ) : (
              <>
                <p className="text-3xl font-semibold text-cosmos-white mt-4">
                  ${Number(tax.data?.totalNet ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-cosmos-muted mt-2">{tax.data?.count ?? 0} linked rows</p>
              </>
            )}
          </Card>
          <Card>
            <CardTitle>Recording liabilities</CardTitle>
            <p className="text-sm text-cosmos-muted mt-3 leading-relaxed">
              Ops integrations call <span className="font-mono text-xs">POST /tax/record</span> with order line
              items to publish <span className="font-mono text-xs">TAX_LIABILITY_RECORDED</span>. There is no list
              API for raw transactions in the admin UI yet; use this card as a quick exposure read from stored MSA
              data.
            </p>
          </Card>
        </div>
      )}
    </div>
  )
}
