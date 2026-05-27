import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/cosmos/status-badge'

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
  supplier?: { id: string; name: string; code: string }
  lines?: PoLine[]
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-order', poId] })
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
  })

  const cancelPo = useMutation({
    mutationFn: () => api.post(`/purchase-orders/${encodeURIComponent(poId)}/cancel`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchase-order', poId] })
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
    },
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
      alert('Receiving session started — continue in mobile warehouse or WMS API.')
      void qc.invalidateQueries({ queryKey: ['purchase-order', poId] })
    },
  })

  const canSubmit = po.data?.status === 'DRAFT'
  const canCancel = po.data?.status === 'DRAFT' || po.data?.status === 'SUBMITTED'
  const canReceiveGoods =
    po.data &&
    po.data.status !== 'DRAFT' &&
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
        <Link to="/admin/purchasing" className="text-sm text-cosmos-muted hover:text-cosmos-white">
          ← Purchasing
        </Link>
      </div>
      {po.isLoading ? (
        <p className="text-cosmos-muted">Loading…</p>
      ) : po.error || !po.data ? (
        <p className="text-red-400">Order not found</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-cosmos-white">PO {po.data.number}</h1>
              <p className="text-cosmos-muted text-sm mt-1">{po.data.supplier?.name}</p>
              <div className="mt-2">
                <StatusBadge status={po.data.status} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canSubmit && (
                <button
                  type="button"
                  disabled={submit.isPending}
                  onClick={() => submit.mutate()}
                  className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
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
                  className="h-9 px-4 rounded-md border border-red-500/50 text-red-300 text-sm disabled:opacity-40"
                >
                  {cancelPo.isPending ? 'Cancelling…' : 'Cancel PO'}
                </button>
              )}
              {canReceiveGoods && (
                <button
                  type="button"
                  onClick={() => setReceiveOpen(true)}
                  className="h-9 px-4 rounded-md bg-cosmos-primary text-white text-sm"
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
                className="h-9 px-4 rounded-md border border-cosmos-border text-cosmos-text text-sm disabled:opacity-40"
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
          {po.data.notes && (
            <p className="text-sm text-cosmos-muted whitespace-pre-wrap">{po.data.notes}</p>
          )}
          <Card>
            <CardTitle>Line items</CardTitle>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-cosmos-muted border-b border-cosmos-border">
                    <th className="pb-2 pr-4">#</th>
                    <th className="pb-2 pr-4">SKU</th>
                    <th className="pb-2 pr-4">Description</th>
                    <th className="pb-2 pr-4">Ordered</th>
                    <th className="pb-2 pr-4">Received</th>
                    <th className="pb-2">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {(po.data.lines ?? []).map((l) => {
                    const received = l.qtyReceived ?? 0
                    const open = Math.max(0, l.qtyOrdered - received)
                    return (
                      <tr key={l.id} className="border-b border-cosmos-border/60">
                        <td className="py-2 pr-4 text-cosmos-muted">{l.lineNo}</td>
                        <td className="py-2 pr-4 font-mono text-cosmos-text">{l.skuCode ?? '—'}</td>
                        <td className="py-2 pr-4 text-cosmos-text">{l.description}</td>
                        <td className="py-2 pr-4 text-cosmos-white">{l.qtyOrdered}</td>
                        <td className="py-2 pr-4 text-cosmos-muted">{received}</td>
                        <td className="py-2 text-cosmos-white">{open}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-cosmos-muted">
              Recording a receipt updates PO quantities and posts stock to the selected warehouse in one step.
            </p>
          </Card>

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
              }}
            />
          )}
        </>
      )}
    </div>
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
      const res = await api.post<{ inventoryErrors?: string[] }>(
        `/purchase-orders/${encodeURIComponent(props.po.id)}/receive`,
        { warehouseId, lines: increments },
      )

      if (res.inventoryErrors?.length) {
        alert(
          'Purchase order receipt saved. Some inventory postings failed:\n\n' + res.inventoryErrors.join('\n'),
        )
      }
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
      <div className="w-full max-w-xl bg-cosmos-surface border-l border-cosmos-border p-6 overflow-y-auto">
        <h2 className="text-lg font-semibold text-cosmos-white">Record receipt</h2>
        <p className="text-xs text-cosmos-muted mt-1">PO {props.po.number}</p>

        <label className="block mt-4 text-xs text-cosmos-muted">Warehouse (inventory)</label>
        <select
          className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
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
              <div key={l.id} className="border border-cosmos-border rounded-md p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-cosmos-text font-medium">
                    Line {l.lineNo} · {l.description}
                  </span>
                  <span className="text-cosmos-muted shrink-0">Open: {open}</span>
                </div>
                {l.skuCode && (
                  <p className="text-xs font-mono text-cosmos-muted mt-1">{l.skuCode}</p>
                )}
                <label className="block mt-2 text-xs text-cosmos-muted">Qty this receipt (max {open})</label>
                <input
                  type="number"
                  min={0}
                  max={open}
                  className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
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
            className="flex-1 h-10 rounded-md border border-cosmos-border text-cosmos-text text-sm"
            onClick={props.onClose}
            disabled={busy}
          >
            Close
          </button>
          <button
            type="button"
            disabled={busy || props.warehouses.length === 0}
            className="flex-1 h-10 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
            onClick={() => void submitReceive()}
          >
            {busy ? 'Saving…' : 'Save receipt'}
          </button>
        </div>
      </div>
    </div>
  )
}
