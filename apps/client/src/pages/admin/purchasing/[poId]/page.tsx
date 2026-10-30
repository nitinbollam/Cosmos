import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Card, CardTitle } from '@pleros/ui'
import { api } from '@/lib/api-admin'
import { showToast } from '@/lib/toast'
import { showReceiptBillingResult, type ReceiptBilling } from '@/lib/receipt-billing'
import { StatusBadge } from '@/components/pleros/status-badge'
import { axiosErr } from '@/lib/axios-error'
import { adminPath } from '@/lib/admin-path'
import { formatAmount, lineAmount, parseAmountInput, sumAmounts } from '@/lib/decimal-amount'
import { hasClientPermission, type Requisition } from '@/lib/requisitions'
import { useUserNames, useViewer } from '@/components/purchasing/use-viewer'

type PoLine = {
  id: string
  lineNo: number
  description: string
  qtyOrdered: number
  qtyReceived?: number
  skuCode?: string | null
  unitCost?: string | number | null
}

type PurchaseOrder = {
  id: string
  number: string
  status: string
  notes?: string | null
  freightAmount?: string | number
  dutyAmount?: string | number
  otherLandedAmount?: string | number
  landedCostNotes?: string | null
  currency?: string
  createdBy?: string | null
  /** Set when the PO was converted from an approved requisition. */
  requisitionId?: string | null
  /** From the server: lines, landed charges and the total the approval limit is checked against. */
  linesTotal?: number
  landedTotal?: number
  total?: number
  supplier?: { id: string; name: string; code: string }
  lines?: PoLine[]
  /** The current supplier bill for this PO, if one exists. */
  supplierBill?: { id: string; billNumber: string; totalAmount: number; status: string } | null
}


function axiosMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(data)) return data.join(', ')
    if (typeof data === 'string') return data
  }
  if (err instanceof Error) return err.message
  return 'Request failed'
}

export default function PurchaseOrderDetailPage() {
  const params = useParams()
  const poId = typeof params.poId === 'string' ? params.poId : params.poId?.[0] ?? ''
  const qc = useQueryClient()
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [freight, setFreight] = useState('0')
  const [duty, setDuty] = useState('0')
  const [otherLanded, setOtherLanded] = useState('0')

  const po = useQuery<PurchaseOrder>({
    queryKey: ['purchase-order', poId],
    queryFn: () => api.get(`/purchase-orders/${encodeURIComponent(poId)}`),
    enabled: !!poId,
  })

  const warehouses = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses'),
  })

  const submit = useMutation({
    mutationFn: () => api.post(`/purchase-orders/${encodeURIComponent(poId)}/submit`, {}),
    onError: () => void qc.invalidateQueries({ queryKey: ['purchase-order', poId] }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-order', poId] })
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      void qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  const cancelPo = useMutation({
    mutationFn: () => api.post(`/purchase-orders/${encodeURIComponent(poId)}/cancel`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-order', poId] })
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      void qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  useEffect(() => {
    if (!po.data) return
    setFreight(String(po.data.freightAmount ?? 0))
    setDuty(String(po.data.dutyAmount ?? 0))
    setOtherLanded(String(po.data.otherLandedAmount ?? 0))
  }, [po.data])

  // A converted PO sends exact decimal strings and is capped by its requisition; a direct PO keeps its old payload.
  const converted = !!po.data?.requisitionId
  const saveLanded = useMutation({
    mutationFn: () =>
      api.patch(
        `/purchase-orders/${encodeURIComponent(poId)}/landed-costs`,
        converted
          ? { freightAmount: freight.trim(), dutyAmount: duty.trim(), otherLandedAmount: otherLanded.trim() }
          : {
              freightAmount: Number(freight.trim() || 0),
              dutyAmount: Number(duty.trim() || 0),
              otherLandedAmount: Number(otherLanded.trim() || 0),
            },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['purchase-order', poId] }),
    onError: async (e) => {
      // Over the approved cap, or changed elsewhere: put the stored values back in the inputs. Set them directly, since
      // an unchanged refetch keeps the same data object and the sync effect above would not run.
      if ((e as { response?: { status?: number } }).response?.status !== 409) return
      const fresh = await po.refetch()
      if (fresh.data) {
        setFreight(String(fresh.data.freightAmount ?? 0))
        setDuty(String(fresh.data.dutyAmount ?? 0))
        setOtherLanded(String(fresh.data.otherLandedAmount ?? 0))
      }
    },
  })
  const landedInputError = converted
    ? ([
        ['Freight', freight],
        ['Duty', duty],
        ['Other', otherLanded],
      ] as const)
        .map(([label, v]) => parseAmountInput(v, label))
        .map((r) => (r.ok ? null : r.error))
        .find(Boolean) ?? null
    : null
  // Direct PO: a blank box counts as 0; anything else must be a number of 0 or more (the server enforces this too).
  const landedInvalid = !converted && [freight, duty, otherLanded].some((v) => v.trim() !== '' && !(Number(v) >= 0))

  type LandedPreview = {
    lines: Array<{ lineNo: number; landedUnitCost: number }>
  }

  const landedPreviewQ = useQuery<LandedPreview>({
    queryKey: ['po-landed-preview', poId, freight, duty, otherLanded],
    enabled: !!poId && Number(freight) + Number(duty) + Number(otherLanded) > 0,
    queryFn: () => api.get(`/purchase-orders/${encodeURIComponent(poId)}/landed-costs`),
  })

  const startReceiving = useMutation({
    mutationFn: async () => {
      const wh = warehouses.data?.[0]
      if (!wh) throw new Error('No warehouse — seed inventory first')
      return api.post('/wms/receiving/sessions', {
        warehouseId: wh.id,
        poId,
      })
    },
    onSuccess: () => {
      showToast('Receiving session started — continue in mobile warehouse or WMS API.', 'success')
      void qc.invalidateQueries({ queryKey: ['purchase-order', poId] })
    },
  })

  const isPendingApproval = po.data?.status === 'PENDING_APPROVAL'
  const canSubmit = po.data?.status === 'DRAFT'
  const canCancel =
    po.data?.status === 'DRAFT' ||
    po.data?.status === 'SUBMITTED' ||
    po.data?.status === 'PENDING_APPROVAL'
  const canReceiveGoods =
    po.data &&
    po.data.status !== 'DRAFT' &&
    po.data.status !== 'PENDING_APPROVAL' &&
    po.data.status !== 'CANCELLED' &&
    po.data.status !== 'CLOSED'
  const canStartWmsSession =
    po.data &&
    (po.data.status === 'SUBMITTED' || po.data.status === 'PARTIALLY_RECEIVED') &&
    warehouses.data &&
    warehouses.data.length > 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/admin/purchasing" className="text-sm text-pleros-muted hover:text-pleros-white">
          ← Purchasing
        </Link>
      </div>
      {po.isLoading ? (
        <p className="text-pleros-muted">Loading…</p>
      ) : po.error || !po.data ? (
        <p className="text-red-400">Order not found</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-pleros-white">PO {po.data.number}</h1>
              <p className="text-pleros-muted text-sm mt-1">{po.data.supplier?.name}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={po.data.status} />
                {isPendingApproval ? (
                  <span className="text-xs px-2 py-0.5 rounded font-medium bg-amber-500/20 text-amber-300">
                    Awaiting manager approval
                  </span>
                ) : null}
              </div>
              {isPendingApproval ? (
                <Link to="/admin/approvals" className="text-sm text-pleros-accent mt-2 inline-block">
                  Review in Approvals inbox →
                </Link>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {canSubmit && (
                <button
                  type="button"
                  disabled={submit.isPending}
                  onClick={() => submit.mutate()}
                  className="h-9 px-4 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-40"
                >
                  {submit.isPending ? 'Submitting…' : 'Submit PO'}
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  disabled={cancelPo.isPending}
                  onClick={() => {
                    if (!confirm('Cancel this purchase order?')) return
                    cancelPo.mutate()
                  }}
                  className="h-9 px-4 rounded-md border text-sm disabled:opacity-40"
                  style={{ borderColor: 'var(--c-danger)', color: 'var(--c-danger)' }}
                >
                  {cancelPo.isPending ? 'Cancelling…' : 'Cancel PO'}
                </button>
              )}
              {canReceiveGoods && (
                <button
                  type="button"
                  onClick={() => setReceiveOpen(true)}
                  className="h-9 px-4 rounded-md bg-pleros-primary text-white text-sm"
                >
                  Record receipt
                </button>
              )}
              <button
                type="button"
                disabled={startReceiving.isPending || !canStartWmsSession}
                onClick={() => startReceiving.mutate()}
                title={
                  !warehouses.data?.length
                    ? 'Need at least one warehouse'
                    : po.data.status === 'DRAFT'
                      ? 'Submit the PO before WMS receiving'
                      : undefined
                }
                className="h-9 px-4 rounded-md border border-pleros-border text-pleros-text text-sm disabled:opacity-40"
              >
                {startReceiving.isPending ? 'Starting…' : 'Start WMS session'}
              </button>
            </div>
          </div>
          {(submit.error || cancelPo.error || startReceiving.error) && (
            <p className="text-sm text-red-400">
              {axiosMessage(submit.error ?? cancelPo.error ?? startReceiving.error)}
            </p>
          )}
          {po.data.requisitionId ? <SourceRequisitionCard po={po.data} /> : null}
          {po.data.notes && (
            <p className="text-sm text-pleros-muted whitespace-pre-wrap">{po.data.notes}</p>
          )}
          <Card>
            <CardTitle>Landed costs</CardTitle>
            <p className="text-xs text-pleros-muted mt-2">
              Freight, duty, and other charges are allocated to received unit cost by line value.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-pleros-muted">
                Freight ($)
                <input
                  className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm"
                  value={freight}
                  inputMode="decimal"
                  disabled={isPendingApproval}
                  onChange={(e) => {
                    saveLanded.reset()
                    setFreight(e.target.value)
                  }}
                />
              </label>
              <label className="text-xs text-pleros-muted">
                Duty ($)
                <input
                  className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm"
                  value={duty}
                  inputMode="decimal"
                  disabled={isPendingApproval}
                  onChange={(e) => {
                    saveLanded.reset()
                    setDuty(e.target.value)
                  }}
                />
              </label>
              <label className="text-xs text-pleros-muted">
                Other ($)
                <input
                  className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm"
                  value={otherLanded}
                  inputMode="decimal"
                  disabled={isPendingApproval}
                  onChange={(e) => {
                    saveLanded.reset()
                    setOtherLanded(e.target.value)
                  }}
                />
              </label>
            </div>
            {converted ? (
              <p className="text-xs text-pleros-muted mt-2">
                Converted from an approved requisition: these may move between each other, but their total cannot exceed the approved landed estimate.
              </p>
            ) : null}
            {landedInputError ? (
              <p className="text-xs text-red-400 mt-2" role="alert">
                {landedInputError}
              </p>
            ) : null}
            <button
              type="button"
              className="mt-3 h-9 px-4 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-50"
              disabled={saveLanded.isPending || !!landedInputError || landedInvalid || isPendingApproval}
              onClick={() => saveLanded.mutate()}
            >
              {saveLanded.isPending ? 'Saving…' : 'Save landed costs'}
            </button>
            {isPendingApproval ? (
              <p className="mt-2 text-xs text-pleros-muted">
                Waiting for approval, so landed costs are locked. If the approver rejects it, the order returns to draft and you can edit them.
              </p>
            ) : null}
            {landedInvalid ? (
              <p className="mt-2 text-xs text-red-400">Freight, duty and other must each be a number of 0 or more.</p>
            ) : null}
            {saveLanded.isError ? (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {axiosErr(saveLanded.error)}
              </p>
            ) : null}
            {saveLanded.isSuccess ? <p className="mt-2 text-xs text-emerald-400">Landed costs saved.</p> : null}
            {landedPreviewQ.data?.lines?.length ? (
              <div className="mt-4 text-xs text-pleros-muted space-y-1">
                {landedPreviewQ.data.lines.map((l) => (
                  <div key={l.lineNo}>
                    Line {l.lineNo}: landed unit cost ${l.landedUnitCost.toFixed(2)}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
          <Card>
            <CardTitle>Line items</CardTitle>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-pleros-muted border-b border-pleros-border">
                    <th className="pb-2 pr-4">#</th>
                    <th className="pb-2 pr-4">SKU</th>
                    <th className="pb-2 pr-4">Description</th>
                    <th className="pb-2 pr-4">Ordered</th>
                    <th className="pb-2 pr-4">Received</th>
                    <th className="pb-2 pr-4">Open</th>
                    <th className="pb-2 pr-4">Unit cost</th>
                    <th className="pb-2">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {(po.data.lines ?? []).map((l) => {
                    const received = l.qtyReceived ?? 0
                    const open = Math.max(0, l.qtyOrdered - received)
                    const cost = l.unitCost != null && l.unitCost !== '' ? Number(l.unitCost) : null
                    // A converted PO carries costs approved to 4 decimals: show them exactly, in this page's plain style.
                    const exact = converted && l.unitCost != null && l.unitCost !== ''
                    const plain = (v: string) => formatAmount(v, po.data?.currency ?? 'USD', { grouping: false })
                    return (
                      <tr key={l.id} className="border-b border-pleros-border/60">
                        <td className="py-2 pr-4 text-pleros-muted">{l.lineNo}</td>
                        <td className="py-2 pr-4 font-mono text-pleros-text">{l.skuCode ?? '—'}</td>
                        <td className="py-2 pr-4 text-pleros-text">{l.description}</td>
                        <td className="py-2 pr-4 text-pleros-white">{l.qtyOrdered}</td>
                        <td className="py-2 pr-4 text-pleros-muted">{received}</td>
                        <td className="py-2 pr-4 text-pleros-white">{open}</td>
                        <td className="py-2 pr-4 text-pleros-text">
                          {exact ? plain(String(l.unitCost)) : cost != null ? `$${cost.toFixed(2)}` : 'No price'}
                        </td>
                        <td className="py-2 text-pleros-white">
                          {exact ? plain(lineAmount(String(l.unitCost), l.qtyOrdered)) : cost != null ? `$${(cost * l.qtyOrdered).toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-pleros-muted">
              Recording a receipt updates PO quantities and posts stock to the selected warehouse in one step.
            </p>
            {po.data?.total != null ? (() => {
              const money = (v: string | number) => formatAmount(v, po.data?.currency ?? 'USD', { grouping: false })
              return (
              <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm" aria-label="Purchase order total">
                <div className="flex justify-between gap-4 text-pleros-text">
                  <dt>Lines</dt>
                  <dd className="tabular-nums">{money(po.data.linesTotal ?? 0)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-pleros-text">
                  <dt>Freight</dt>
                  <dd className="tabular-nums">{money(po.data.freightAmount ?? 0)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-pleros-text">
                  <dt>Duty</dt>
                  <dd className="tabular-nums">{money(po.data.dutyAmount ?? 0)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-pleros-text">
                  <dt>Other charges</dt>
                  <dd className="tabular-nums">{money(po.data.otherLandedAmount ?? 0)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-pleros-border pt-1 font-semibold text-pleros-white">
                  <dt>PO total</dt>
                  <dd className="tabular-nums">{money(po.data.total)}</dd>
                </div>
              </dl>
              )
            })() : null}
            {po.data?.lines?.some((l) => l.unitCost == null || l.unitCost === '') ? (
              <p className="mt-2 text-xs text-amber-400">
                Some lines have no price (an older order), so this total is lower than the real cost.
              </p>
            ) : null}
          </Card>

          <SupplierBillCard po={po.data} />

          {receiveOpen && po.data && (
            <ReceiveDrawer
              po={po.data}
              warehouses={warehouses.data ?? []}
              warehousesLoading={warehouses.isLoading}
              onClose={() => setReceiveOpen(false)}
              onDone={() => {
                setReceiveOpen(false)
                void qc.invalidateQueries({ queryKey: ['purchase-order', poId] })
                void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
                void qc.invalidateQueries({ queryKey: ['finance', 'bills-ap'] })
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

/** Where a converted PO came from: its requisition, who approved it, and the landed-cost cap. */
function SourceRequisitionCard({ po }: { po: PurchaseOrder }) {
  const { viewer } = useViewer()
  const nameOf = useUserNames(viewer)
  const canRead = hasClientPermission(viewer, 'requisitions.read')
  const req = useQuery<Requisition>({
    queryKey: ['purchase-requisition', po.requisitionId],
    queryFn: () => api.get(`/purchase-requisitions/${encodeURIComponent(po.requisitionId ?? '')}`),
    enabled: canRead && !!po.requisitionId,
    retry: false,
  })
  const r = req.data
  return (
    <Card>
      <CardTitle>Source requisition</CardTitle>
      {r ? (
        <div className="mt-3 text-sm space-y-1">
          <p>
            <Link to={adminPath(`/purchasing/requisitions/${r.id}`)} className="text-pleros-accent font-mono">
              {r.number}
            </Link>{' '}
            <span className="text-pleros-muted">
              requested by {nameOf(r.requestedBy)}, approved by {nameOf(r.approvedBy)}
              {r.approvedAt ? ` on ${new Date(r.approvedAt).toLocaleDateString()}` : ''}
            </span>
          </p>
          <p className="text-xs text-pleros-muted">
            Approved landed estimate {formatAmount(sumAmounts([r.freightAmount, r.dutyAmount, r.otherLandedAmount]), r.currency)}. Submitting this PO needs no further
            approval while it still matches the requisition.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-pleros-muted">
          {req.isLoading ? 'Loading…' : 'Converted from an approved requisition. Submitting it needs no further approval while it still matches.'}
        </p>
      )}
    </Card>
  )
}

/** The PO's supplier bill, or a way to create it when goods were received but billing failed. */
function SupplierBillCard({ po }: { po: PurchaseOrder }) {
  const qc = useQueryClient()
  const received = (po.lines ?? []).some((l) => (l.qtyReceived ?? 0) > 0)
  const createBill = useMutation({
    mutationFn: () => api.post<{ billNumber: string }>('/bills/from-po', { purchaseOrderId: po.id }),
    onSuccess: (bill) => {
      showToast(`Supplier bill ${bill.billNumber} created`, 'success')
      void qc.invalidateQueries({ queryKey: ['purchase-order', po.id] })
      void qc.invalidateQueries({ queryKey: ['finance', 'bills-ap'] })
    },
    onError: (e) => showToast(axiosMessage(e), 'error', 8000),
  })
  const bill = po.supplierBill

  return (
    <Card>
      <CardTitle>Supplier bill</CardTitle>
      {bill ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono text-pleros-white">{bill.billNumber}</span>
          <span className="text-pleros-white">${bill.totalAmount.toFixed(2)}</span>
          <StatusBadge status={bill.status} />
          <Link to="/admin/finance" className="text-xs text-pleros-accent">
            Open Finance → Bills →
          </Link>
        </div>
      ) : received ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-pleros-text">Goods were received but there is no supplier bill yet.</span>
          <button
            type="button"
            className="btn-primary !text-xs !py-1"
            disabled={createBill.isPending}
            onClick={() => createBill.mutate()}
          >
            {createBill.isPending ? 'Creating…' : 'Create bill'}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-pleros-muted">A supplier bill is created automatically when goods are received.</p>
      )}
    </Card>
  )
}

function ReceiveDrawer(props: {
  po: PurchaseOrder
  warehouses: Array<{ id: string; name: string }>
  warehousesLoading: boolean
  onClose: () => void
  onDone: () => void
}) {
  const lines = props.po.lines ?? []
  const [warehouseId, setWarehouseId] = useState(props.warehouses[0]?.id ?? '')
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, 0])),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!warehouseId && props.warehouses[0]?.id) setWarehouseId(props.warehouses[0].id)
  }, [props.warehouses, warehouseId])

  async function submitReceive() {
    setError(null)
    const increments = lines
      .map((l) => ({ lineId: l.id, qtyReceived: Math.max(0, Math.floor(qtyByLine[l.id] ?? 0)) }))
      .filter((x) => x.qtyReceived > 0)
    if (increments.length === 0) {
      setError('Enter at least one line quantity to receive.')
      return
    }
    if (!warehouseId.trim()) {
      setError('Select a warehouse.')
      return
    }
    setBusy(true)
    try {
      const res = await api.post<{ inventoryErrors?: string[] } & ReceiptBilling>(
        `/purchase-orders/${encodeURIComponent(props.po.id)}/receive`,
        { warehouseId, lines: increments },
      )

      if (res.inventoryErrors?.length) {
        showToast(
          `Receipt saved, but ${res.inventoryErrors.length} inventory posting(s) failed: ${res.inventoryErrors.join('; ')}`,
          'error',
          8000,
        )
      }
      showReceiptBillingResult(res)
      props.onDone()
    } catch (e) {
      setError(axiosMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={props.onClose} />
      <div className="w-full max-w-xl bg-pleros-surface border-l border-pleros-border p-6 overflow-y-auto">
        <h2 className="text-lg font-semibold text-pleros-white">Record receipt</h2>
        <p className="text-xs text-pleros-muted mt-1">PO {props.po.number}</p>

        <label className="block mt-4 text-xs text-pleros-muted">Warehouse (inventory)</label>
        <select
          className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
          value={warehouseId}
          disabled={props.warehousesLoading}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          {props.warehouses.length === 0 ? (
            <option value="">No warehouses</option>
          ) : (
            props.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))
          )}
        </select>

        <div className="mt-4 space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {lines.map((l) => {
            const received = l.qtyReceived ?? 0
            const open = Math.max(0, l.qtyOrdered - received)
            const v = qtyByLine[l.id] ?? 0
            return (
              <div key={l.id} className="border border-pleros-border rounded-md p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-pleros-text font-medium">
                    Line {l.lineNo} · {l.description}
                  </span>
                  <span className="text-pleros-muted shrink-0">Open: {open}</span>
                </div>
                {l.skuCode && (
                  <p className="text-xs font-mono text-pleros-muted mt-1">{l.skuCode}</p>
                )}
                <label className="block mt-2 text-xs text-pleros-muted">Qty this receipt (max {open})</label>
                <input
                  type="number"
                  min={0}
                  max={open}
                  className="mt-1 w-full rounded-md bg-pleros-surface-2 border border-pleros-border px-3 py-2 text-sm text-pleros-text"
                  value={v}
                  onChange={(e) => {
                    const n = Math.max(0, Math.min(open, Number(e.target.value) || 0))
                    setQtyByLine((m) => ({ ...m, [l.id]: n }))
                  }}
                />
              </div>
            )
          })}
        </div>

        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            className="flex-1 h-10 rounded-md border border-pleros-border text-pleros-text text-sm"
            onClick={props.onClose}
            disabled={busy}
          >
            Close
          </button>
          <button
            type="button"
            disabled={busy || props.warehouses.length === 0}
            className="flex-1 h-10 rounded-md bg-pleros-primary text-white text-sm disabled:opacity-40"
            onClick={() => void submitReceive()}
          >
            {busy ? 'Saving…' : 'Save receipt'}
          </button>
        </div>
      </div>
    </div>
  )
}
