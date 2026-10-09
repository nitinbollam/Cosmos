import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/pleros/status-badge'
import { EmptyState } from '@/components/pleros/empty-state'
import { SpreadsheetImportPanel } from '@/components/pleros/spreadsheet-import-panel'
import { rowNumber, rowValue, type BulkImportResult } from '@/lib/spreadsheet-import'
import { PlerosDialogModal } from '@/components/pleros/radix-overlays'

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

type BatchOption = {
  skuId: string
  skuCode: string
  skuName: string
  batchNumber: string
  warehouseId: string
  expiryDate: string | null
  totalOnHand: number
  isRecalled: boolean
}

type BatchRecallItem = {
  id: string
  tenantId: string
  recallCode: string
  skuId: string
  skuCode: string
  skuName: string
  batchNumber: string
  reason: string
  severity: 'MANDATORY' | 'VOLUNTARY' | 'CAUTION'
  status: 'ACTIVE' | 'RESOLVED'
  initiatedBy: string | null
  notes: string | null
  recalledAt: string
  resolvedAt: string | null
}

type ImpactReportData = {
  recall: BatchRecallItem
  summary: {
    totalWarehouseUnits: number
    totalShippedUnits: number
    totalRecalledUnits: number
    blockedOrdersCount: number
    affectedCustomersCount: number
    warehouseStockValue: number
    shippedStockValue: number
    totalFinancialExposure: number
  }
  inventoryExposure: Array<{
    warehouseId: string
    warehouseName: string
    warehouseCode: string
    quantityOnHand: number
    quantityReserved: number
    quantityAvailable: number
    expiryDate: string | null
  }>
  blockedOrders: Array<{
    orderId: string
    orderNumber: string
    customerId: string
    customerName: string
    orderDate: string
    orderStatus: string
    reservedQuantity: number
    fulfillmentStatus: string
  }>
  customerTraceability: Array<{
    orderId: string
    orderNumber: string
    customerId: string
    customerName: string
    customerEmail: string | null
    customerPhone: string | null
    shippingAddressStr: string
    shippedQuantity: number
    shippedAt: string | null
    carrier: string | null
    trackingNumber: string | null
    deliveryStatus: string
  }>
}

const MSA_FILTERS: Array<{ label: string; value: '' | MsaStatus }> = [
  { label: 'All', value: '' },
  { label: 'Generated', value: 'GENERATED' },
  { label: 'Submitted', value: 'SUBMITTED' },
  { label: 'Failed', value: 'SUBMISSION_FAILED' },
  { label: 'Accepted', value: 'ACCEPTED' },
]

const RECALL_FILTERS = [
  { label: 'All Recalls', value: '' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Resolved', value: 'RESOLVED' },
]

export default function CompliancePage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'msa' | 'tax' | 'recalls'>('recalls')
  const [statusFilter, setStatusFilter] = useState<'' | MsaStatus>('')
  const [recallFilter, setRecallFilter] = useState<'' | 'ACTIVE' | 'RESOLVED'>('')
  const [importOpen, setImportOpen] = useState(false)

  // Initiate Recall modal state
  const [initiateModalOpen, setInitiateModalOpen] = useState(false)
  const [selectedBatchKey, setSelectedBatchKey] = useState('')
  const [recallReason, setRecallReason] = useState('')
  const [recallSeverity, setRecallSeverity] = useState<'MANDATORY' | 'VOLUNTARY' | 'CAUTION'>('MANDATORY')
  const [initiatedBy, setInitiatedBy] = useState('')
  const [recallNotes, setRecallNotes] = useState('')

  // View Impact Report modal state
  const [reportModalRecallId, setReportModalRecallId] = useState<string | null>(null)

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

  const recallsQ = useQuery<BatchRecallItem[]>({
    queryKey: ['compliance', 'recalls', recallFilter],
    queryFn: () =>
      recallFilter
        ? api.get(`/compliance/recalls?status=${encodeURIComponent(recallFilter)}`)
        : api.get('/compliance/recalls'),
    enabled: tab === 'recalls',
  })

  const availableBatchesQ = useQuery<BatchOption[]>({
    queryKey: ['compliance', 'batches'],
    queryFn: () => api.get('/compliance/batches'),
    enabled: initiateModalOpen,
  })

  const impactReportQ = useQuery<ImpactReportData>({
    queryKey: ['compliance', 'recalls', reportModalRecallId, 'impact-report'],
    queryFn: () => api.get(`/compliance/recalls/${reportModalRecallId}/impact-report`),
    enabled: Boolean(reportModalRecallId),
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

  const initiateRecallMut = useMutation({
    mutationFn: (payload: {
      skuId: string
      batchNumber: string
      reason: string
      severity: string
      initiatedBy?: string
      notes?: string
    }) => api.post('/compliance/recalls', payload),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['compliance', 'recalls'] })
      void qc.invalidateQueries({ queryKey: ['compliance', 'batches'] })
      setInitiateModalOpen(false)
      setSelectedBatchKey('')
      setRecallReason('')
      setInitiatedBy('')
      setRecallNotes('')
      const report = data as ImpactReportData
      if (report?.recall?.id) {
        setReportModalRecallId(report.recall.id)
      }
    },
  })

  const resolveRecallMut = useMutation({
    mutationFn: (id: string) => api.post(`/compliance/recalls/${id}/resolve`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['compliance', 'recalls'] })
      void qc.invalidateQueries({ queryKey: ['compliance', 'batches'] })
      if (reportModalRecallId) {
        void qc.invalidateQueries({
          queryKey: ['compliance', 'recalls', reportModalRecallId, 'impact-report'],
        })
      }
    },
  })

  const handleInitiateSubmit = () => {
    if (!selectedBatchKey || !recallReason.trim()) return
    const [skuId, batchNumber] = selectedBatchKey.split(':::')
    if (!skuId || !batchNumber) return

    initiateRecallMut.mutate({
      skuId,
      batchNumber,
      reason: recallReason.trim(),
      severity: recallSeverity,
      initiatedBy: initiatedBy.trim() || undefined,
      notes: recallNotes.trim() || undefined,
    })
  }

  const exportCustomerTraceabilityCsv = (report: ImpactReportData) => {
    const headers = [
      'Customer Name',
      'Email',
      'Phone',
      'Order Number',
      'Shipped Quantity',
      'Ship Date',
      'Carrier',
      'Tracking Number',
      'Address',
    ]
    const rows = report.customerTraceability.map((c) => [
      `"${(c.customerName || '').replace(/"/g, '""')}"`,
      `"${(c.customerEmail || '').replace(/"/g, '""')}"`,
      `"${(c.customerPhone || '').replace(/"/g, '""')}"`,
      `"${c.orderNumber}"`,
      c.shippedQuantity,
      c.shippedAt ? new Date(c.shippedAt).toLocaleDateString() : '',
      `"${(c.carrier || '').replace(/"/g, '""')}"`,
      `"${(c.trackingNumber || '').replace(/"/g, '""')}"`,
      `"${(c.shippingAddressStr || '').replace(/"/g, '""')}"`,
    ])

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `Recall_Traceability_${report.recall.recallCode}_Customers.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-pleros-white">Compliance</h1>
          <p className="text-pleros-muted text-sm mt-1">
            Batch recalls & shipping blocks, MSA reporting, and tax liability tracking.
          </p>
        </div>
        <div className="flex rounded-lg border border-pleros-border overflow-hidden">
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'recalls' ? 'bg-pleros-primary text-white font-medium' : 'text-pleros-text hover:bg-pleros-primary/10'}`}
            onClick={() => setTab('recalls')}
          >
            Batch Recalls
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'msa' ? 'bg-pleros-primary text-white font-medium' : 'text-pleros-text hover:bg-pleros-primary/10'}`}
            onClick={() => setTab('msa')}
          >
            MSA
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm ${tab === 'tax' ? 'bg-pleros-primary text-white font-medium' : 'text-pleros-text hover:bg-pleros-primary/10'}`}
            onClick={() => setTab('tax')}
          >
            Tax
          </button>
        </div>
      </div>

      {tab === 'recalls' && (
        <>
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              {RECALL_FILTERS.map((f) => (
                <button
                  key={f.label}
                  type="button"
                  onClick={() => setRecallFilter(f.value as '' | 'ACTIVE' | 'RESOLVED')}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                    recallFilter === f.value
                      ? 'border-pleros-primary bg-pleros-primary/20 text-pleros-white'
                      : 'border-pleros-border text-pleros-muted hover:text-pleros-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setInitiateModalOpen(true)}
              className="h-9 px-4 rounded-md bg-red-600 hover:bg-red-500 text-white font-medium text-sm flex items-center gap-2 shadow"
            >
              <span>🚨</span> Initiate Batch Recall
            </button>
          </div>

          <Card>
            <CardTitle>Batch & Lot Recalls</CardTitle>
            <p className="text-xs text-pleros-muted mt-1">
              Recalled batches are automatically blocked from FEFO allocation, WMS picking, packing, shipment creation, and route dispatching.
            </p>
            {recallsQ.isLoading ? (
              <p className="text-sm text-pleros-muted mt-4">Loading recalls…</p>
            ) : recallsQ.isError ? (
              <p className="text-sm text-red-400 mt-4">Could not load recalls.</p>
            ) : (recallsQ.data ?? []).length === 0 ? (
              <EmptyState
                icon="🛡️"
                title="No batch recalls found"
                description="No batches are currently flagged for recall. Click 'Initiate Batch Recall' to quarantine a defective lot."
              />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-pleros-muted border-b border-pleros-border">
                      <th className="pb-2 pr-4">Recall Code</th>
                      <th className="pb-2 pr-4">Product / SKU</th>
                      <th className="pb-2 pr-4">Batch Number</th>
                      <th className="pb-2 pr-4">Severity</th>
                      <th className="pb-2 pr-4">Reason</th>
                      <th className="pb-2 pr-4">Initiated</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recallsQ.data ?? []).map((r) => (
                      <tr key={r.id} className="border-b border-pleros-border/60 hover:bg-pleros-border/20">
                        <td className="py-2.5 pr-4 font-mono text-xs font-semibold text-pleros-white">
                          {r.recallCode}
                        </td>
                        <td className="py-2.5 pr-4 text-pleros-text">
                          <div className="font-medium">{r.skuName}</div>
                          <div className="font-mono text-xs text-pleros-muted">{r.skuCode}</div>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-xs text-red-400 font-bold">
                          {r.batchNumber}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              r.severity === 'MANDATORY'
                                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                                : r.severity === 'VOLUNTARY'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            }`}
                          >
                            {r.severity}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-pleros-text max-w-[220px] truncate" title={r.reason}>
                          {r.reason}
                        </td>
                        <td className="py-2.5 pr-4 text-pleros-muted text-xs whitespace-nowrap">
                          {new Date(r.recalledAt).toLocaleDateString()}
                        </td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="py-2.5">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setReportModalRecallId(r.id)}
                              className="text-xs text-pleros-primary hover:underline font-medium"
                            >
                              Impact Report →
                            </button>
                            {r.status === 'ACTIVE' && (
                              <button
                                type="button"
                                disabled={resolveRecallMut.isPending}
                                onClick={() => resolveRecallMut.mutate(r.id)}
                                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
                              >
                                Resolve
                              </button>
                            )}
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
                    ? 'border-pleros-primary bg-pleros-primary/20 text-pleros-white'
                    : 'border-pleros-border text-pleros-muted'
                }`}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              className="h-9 px-4 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-40"
            >
              {generate.isPending ? 'Generating…' : 'Generate weekly drafts'}
            </button>
            <button
              type="button"
              onClick={() => runCron.mutate()}
              disabled={runCron.isPending}
              className="h-9 px-4 rounded-md border border-pleros-border text-sm text-pleros-text disabled:opacity-40"
            >
              {runCron.isPending ? 'Running…' : 'Run full automation'}
            </button>
          </div>
          {(generate.error || runCron.error) && (
            <p className="text-red-400 text-sm">
              {String((generate.error ?? (runCron.error as Error))?.message ?? 'MSA action failed')}
            </p>
          )}
          {runCron.data ? (
            <p className="text-xs text-pleros-muted">
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
              <p className="text-sm text-pleros-muted mt-3">Loading…</p>
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
                    <tr className="text-left text-pleros-muted border-b border-pleros-border">
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
                      <tr key={r.id} className="border-b border-pleros-border/60">
                        <td className="py-2 pr-4 font-mono text-xs text-pleros-text max-w-[200px] truncate">
                          {r.manufacturerDid}
                        </td>
                        <td className="py-2 pr-4 text-pleros-muted whitespace-nowrap">
                          {new Date(r.weekEnding).toLocaleDateString()}
                        </td>
                        <td className="py-2 pr-4 text-pleros-white">{r.totalTransactions}</td>
                        <td className="py-2 pr-4 font-mono text-pleros-text">
                          ${Number(r.netPurchases ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 pr-4">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2 items-center">
                            <Link
                              to={adminPath(`/compliance/msa/${r.id}`)}
                              className="text-pleros-primary text-xs whitespace-nowrap"
                            >
                              View
                            </Link>
                            {r.status === 'GENERATED' ? (
                              <>
                                <button
                                  type="button"
                                  className="text-xs text-pleros-muted hover:text-pleros-white"
                                  disabled={uploadReport.isPending}
                                  onClick={() => uploadReport.mutate(r.id)}
                                >
                                  Upload
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-pleros-muted hover:text-pleros-white"
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
            <p className="text-xs text-pleros-muted mt-2">
              Totals <span className="font-mono text-pleros-text/80">netAmount</span> across qualifying MSA
              transactions for this tenant (not sales tax collected at checkout).
            </p>
            {tax.isLoading ? (
              <p className="text-sm text-pleros-muted mt-4">Loading…</p>
            ) : tax.isError ? (
              <p className="text-sm text-red-400 mt-4">Could not load summary.</p>
            ) : (
              <>
                <p className="text-3xl font-semibold text-pleros-white mt-4">
                  ${Number(tax.data?.totalNet ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-pleros-muted mt-2">{tax.data?.count ?? 0} linked rows</p>
              </>
            )}
          </Card>
          <Card>
            <CardTitle>Recording liabilities</CardTitle>
            <p className="text-sm text-pleros-muted mt-3 leading-relaxed">
              Tax liabilities are recorded when orders with taxable lines are processed. This card shows exposure from
              stored compliance data. A full transaction list will land in a later release.
            </p>
          </Card>
        </div>
      )}

      {/* Modal: Initiate Batch Recall */}
      <PlerosDialogModal
        open={initiateModalOpen}
        onOpenChange={setInitiateModalOpen}
        title="Initiate Batch / Lot Recall"
        maxWidthClass="max-w-lg"
      >
        <p className="text-xs text-pleros-muted mb-4">
          Flagging a batch will instantly quarantine all current inventory and block picking, packing, and shipping across the platform.
        </p>

        {initiateRecallMut.isError && (
          <div className="p-3 mb-4 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono">
            {(initiateRecallMut.error as Error)?.message || 'Failed to initiate recall'}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-pleros-muted mb-1 font-medium">Select Batch & Product</label>
            {availableBatchesQ.isLoading ? (
              <p className="text-xs text-pleros-muted">Loading available batches…</p>
            ) : (
              <select
                className="pleros-input text-sm w-full font-mono"
                value={selectedBatchKey}
                onChange={(e) => setSelectedBatchKey(e.target.value)}
              >
                <option value="">-- Choose Batch / Lot Number --</option>
                {(availableBatchesQ.data ?? []).map((b) => (
                  <option
                    key={`${b.skuId}:::${b.batchNumber}`}
                    value={`${b.skuId}:::${b.batchNumber}`}
                    disabled={b.isRecalled}
                  >
                    {b.batchNumber} - {b.skuName} ({b.skuCode}) [{b.totalOnHand} units on hand]{' '}
                    {b.isRecalled ? '(ALREADY RECALLED)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs text-pleros-muted mb-1 font-medium">Recall Severity</label>
            <select
              className="pleros-input text-sm w-full font-medium"
              value={recallSeverity}
              onChange={(e) => setRecallSeverity(e.target.value as 'MANDATORY' | 'VOLUNTARY' | 'CAUTION')}
            >
              <option value="MANDATORY">🔴 MANDATORY - Class I (Critical health/safety risk)</option>
              <option value="VOLUNTARY">🟡 VOLUNTARY - Class II (Quality or labeling defect)</option>
              <option value="CAUTION">🔵 CAUTION - Class III (Precautionary hold)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-pleros-muted mb-1 font-medium">Recall Reason *</label>
            <input
              type="text"
              className="pleros-input text-sm w-full"
              placeholder="e.g., Contamination detected in Lot #44, failed stability testing..."
              value={recallReason}
              onChange={(e) => setRecallReason(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-pleros-muted mb-1 font-medium">Initiated By (User / Auditor)</label>
            <input
              type="text"
              className="pleros-input text-sm w-full"
              placeholder="e.g. Quality Manager / FDA Notice"
              value={initiatedBy}
              onChange={(e) => setInitiatedBy(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs text-pleros-muted mb-1 font-medium">Notes & Instructions</label>
            <textarea
              rows={3}
              className="pleros-input text-sm w-full"
              placeholder="Internal notes for warehouse team and customer service..."
              value={recallNotes}
              onChange={(e) => setRecallNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button type="button" className="btn-ghost text-sm" onClick={() => setInitiateModalOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-40"
            disabled={!selectedBatchKey || !recallReason.trim() || initiateRecallMut.isPending}
            onClick={handleInitiateSubmit}
          >
            {initiateRecallMut.isPending ? 'Quarantining…' : 'Execute Recall & Block Shipping'}
          </button>
        </div>
      </PlerosDialogModal>

      {/* Modal: View Impact Report */}
      <PlerosDialogModal
        open={Boolean(reportModalRecallId)}
        onOpenChange={(o) => !o && setReportModalRecallId(null)}
        title="Recall Downstream Impact Report"
        maxWidthClass="max-w-4xl"
      >
        {impactReportQ.isLoading ? (
          <p className="text-sm text-pleros-muted py-8 text-center">Generating impact analysis…</p>
        ) : impactReportQ.isError ? (
          <p className="text-sm text-red-400 py-8 text-center">Could not load impact report.</p>
        ) : impactReportQ.data ? (
          <div className="space-y-6">
            {/* Header info */}
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex flex-wrap justify-between items-center gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-red-400">{impactReportQ.data.recall.recallCode}</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-500/30 text-red-300">
                    {impactReportQ.data.recall.severity}
                  </span>
                  <span className="text-xs text-pleros-muted">
                    • Recalled {new Date(impactReportQ.data.recall.recalledAt).toLocaleString()}
                  </span>
                </div>
                <h3 className="text-base font-bold text-pleros-white mt-1">
                  Batch: {impactReportQ.data.recall.batchNumber} — {impactReportQ.data.recall.skuName}
                </h3>
                <p className="text-xs text-pleros-text mt-0.5">
                  <span className="text-pleros-muted">Reason:</span> {impactReportQ.data.recall.reason}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {impactReportQ.data.recall.status === 'ACTIVE' ? (
                  <button
                    type="button"
                    onClick={() => resolveRecallMut.mutate(impactReportQ.data.recall.id)}
                    disabled={resolveRecallMut.isPending}
                    className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                  >
                    Resolve & Lift Block
                  </button>
                ) : (
                  <span className="px-3 py-1 rounded bg-emerald-500/20 text-emerald-400 text-xs font-semibold border border-emerald-500/30">
                    RESOLVED
                  </span>
                )}
              </div>
            </div>

            {/* KPI Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded bg-pleros-border/30 border border-pleros-border">
                <div className="text-xs text-pleros-muted">Warehouse Stock (Blocked)</div>
                <div className="text-xl font-bold text-red-400 mt-1 font-mono">
                  {impactReportQ.data.summary.totalWarehouseUnits.toLocaleString()} units
                </div>
                <div className="text-[11px] text-pleros-muted mt-0.5">
                  ${impactReportQ.data.summary.warehouseStockValue.toLocaleString()} cost
                </div>
              </div>
              <div className="p-3 rounded bg-pleros-border/30 border border-pleros-border">
                <div className="text-xs text-pleros-muted">Shipped Stock (In-Field)</div>
                <div className="text-xl font-bold text-amber-400 mt-1 font-mono">
                  {impactReportQ.data.summary.totalShippedUnits.toLocaleString()} units
                </div>
                <div className="text-[11px] text-pleros-muted mt-0.5">
                  ${impactReportQ.data.summary.shippedStockValue.toLocaleString()} sales
                </div>
              </div>
              <div className="p-3 rounded bg-pleros-border/30 border border-pleros-border">
                <div className="text-xs text-pleros-muted">Blocked Open Orders</div>
                <div className="text-xl font-bold text-pleros-white mt-1 font-mono">
                  {impactReportQ.data.summary.blockedOrdersCount} orders
                </div>
                <div className="text-[11px] text-red-400 font-medium mt-0.5">Shipping Blocked</div>
              </div>
              <div className="p-3 rounded bg-pleros-border/30 border border-pleros-border">
                <div className="text-xs text-pleros-muted">Affected Customers</div>
                <div className="text-xl font-bold text-pleros-white mt-1 font-mono">
                  {impactReportQ.data.summary.affectedCustomersCount} accounts
                </div>
                <div className="text-[11px] text-pleros-muted mt-0.5">Requires Notice</div>
              </div>
            </div>

            {/* Section 1: Warehouse Stock Exposure */}
            <div>
              <h4 className="text-sm font-semibold text-pleros-white mb-2">1. Warehouse Inventory Quarantined</h4>
              {impactReportQ.data.inventoryExposure.length === 0 ? (
                <p className="text-xs text-pleros-muted">No physical warehouse stock remaining for this batch.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-pleros-border text-left text-pleros-muted">
                        <th className="pb-1.5 pr-4">Warehouse</th>
                        <th className="pb-1.5 pr-4">On Hand</th>
                        <th className="pb-1.5 pr-4">Reserved</th>
                        <th className="pb-1.5 pr-4">Available (Blocked)</th>
                        <th className="pb-1.5">Expiry Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impactReportQ.data.inventoryExposure.map((inv) => (
                        <tr key={inv.warehouseId} className="border-b border-pleros-border/40">
                          <td className="py-1.5 pr-4 font-medium text-pleros-text">{inv.warehouseName} ({inv.warehouseCode})</td>
                          <td className="py-1.5 pr-4 font-mono text-red-400 font-bold">{inv.quantityOnHand}</td>
                          <td className="py-1.5 pr-4 font-mono text-pleros-muted">{inv.quantityReserved}</td>
                          <td className="py-1.5 pr-4 font-mono text-amber-400">{inv.quantityAvailable}</td>
                          <td className="py-1.5 font-mono text-pleros-muted">
                            {inv.expiryDate ? new Date(inv.expiryDate).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Section 2: Blocked Open Orders */}
            <div>
              <h4 className="text-sm font-semibold text-pleros-white mb-2">2. Open Orders Blocked from Fulfillment</h4>
              {impactReportQ.data.blockedOrders.length === 0 ? (
                <p className="text-xs text-pleros-muted">No open pending orders currently hold this batch.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-pleros-border text-left text-pleros-muted">
                        <th className="pb-1.5 pr-4">Order #</th>
                        <th className="pb-1.5 pr-4">Customer</th>
                        <th className="pb-1.5 pr-4">Date</th>
                        <th className="pb-1.5 pr-4">Recalled Qty</th>
                        <th className="pb-1.5">Fulfillment Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impactReportQ.data.blockedOrders.map((ord) => (
                        <tr key={ord.orderId} className="border-b border-pleros-border/40">
                          <td className="py-1.5 pr-4 font-mono font-medium text-pleros-white">{ord.orderNumber}</td>
                          <td className="py-1.5 pr-4 text-pleros-text">{ord.customerName}</td>
                          <td className="py-1.5 pr-4 text-pleros-muted">
                            {new Date(ord.orderDate).toLocaleDateString()}
                          </td>
                          <td className="py-1.5 pr-4 font-mono font-bold text-red-400">{ord.reservedQuantity}</td>
                          <td className="py-1.5">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300 border border-red-500/40">
                              BLOCKED ({ord.fulfillmentStatus})
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Section 3: Shipped Customer Traceability & Export */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-pleros-white">3. Customer Traceability & Recall Notification List</h4>
                {impactReportQ.data.customerTraceability.length > 0 && (
                  <button
                    type="button"
                    onClick={() => exportCustomerTraceabilityCsv(impactReportQ.data!)}
                    className="px-3 py-1 rounded bg-pleros-primary hover:bg-pleros-primary/80 text-white text-xs font-semibold flex items-center gap-1.5 shadow"
                  >
                    <span>📥</span> Export Customer List (CSV)
                  </button>
                )}
              </div>
              {impactReportQ.data.customerTraceability.length === 0 ? (
                <p className="text-xs text-pleros-muted">No shipped orders were recorded with this batch.</p>
              ) : (
                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-pleros-border text-left text-pleros-muted sticky top-0 bg-pleros-card">
                        <th className="pb-1.5 pr-4">Customer Name</th>
                        <th className="pb-1.5 pr-4">Contact Info</th>
                        <th className="pb-1.5 pr-4">Order #</th>
                        <th className="pb-1.5 pr-4">Shipped Qty</th>
                        <th className="pb-1.5 pr-4">Ship Date</th>
                        <th className="pb-1.5">Tracking / Carrier</th>
                      </tr>
                    </thead>
                    <tbody>
                      {impactReportQ.data.customerTraceability.map((cust, idx) => (
                        <tr key={`${cust.orderId}-${idx}`} className="border-b border-pleros-border/40">
                          <td className="py-1.5 pr-4 font-medium text-pleros-white">{cust.customerName}</td>
                          <td className="py-1.5 pr-4 text-pleros-muted font-mono text-[11px]">
                            <div>{cust.customerEmail || 'No email'}</div>
                            <div>{cust.customerPhone || ''}</div>
                          </td>
                          <td className="py-1.5 pr-4 font-mono text-pleros-text">{cust.orderNumber}</td>
                          <td className="py-1.5 pr-4 font-mono font-bold text-amber-400">{cust.shippedQuantity}</td>
                          <td className="py-1.5 pr-4 text-pleros-muted">
                            {cust.shippedAt ? new Date(cust.shippedAt).toLocaleDateString() : '—'}
                          </td>
                          <td className="py-1.5 text-pleros-muted font-mono text-[11px]">
                            {cust.carrier ? `${cust.carrier} ${cust.trackingNumber || ''}` : 'Standard Ground'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end mt-6">
          <button type="button" className="btn-ghost text-sm" onClick={() => setReportModalRecallId(null)}>
            Close
          </button>
        </div>
      </PlerosDialogModal>
    </div>
  )
}
