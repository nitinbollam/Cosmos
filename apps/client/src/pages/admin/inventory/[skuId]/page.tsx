import { Link } from 'react-router-dom'
import { useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-admin'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { CosmosDialogModal } from '@/components/cosmos/radix-overlays'

type Sku = {
  id: string
  code: string
  name: string
  category: string
  description?: string | null
  isActive: boolean
  isTobacco: boolean
  barcode?: string | null
  unitOfMeasure: string
  cost: string | number
  price: string | number
  minPrice?: string | number | null
  manufacturerDid?: string | null
  exciseTaxCategory?: string | null
}

type StockLevel = {
  id: string
  warehouseId: string
  locationId?: string | null
  batchId?: string | null
  quantityOnHand: number
  quantityReserved: number
  quantityAvailable: number
  reorderPoint: number
  reorderQty?: number
}

type LedgerRow = {
  id: string
  warehouseId: string
  locationId?: string | null
  batchId?: string | null
  eventType: string
  quantityDelta: number
  quantityAfter: number
  unitCost: string | number
  referenceId?: string | null
  referenceType?: string | null
  performedBy: string
  occurredAt: string
}

type WarehouseRow = { id: string; name: string; code: string }

function isNonBatchBatchId(batchId: string | null | undefined) {
  return batchId == null || batchId === ''
}

export default function SkuDetailPage() {
  const params = useParams()
  const skuId = decodeURIComponent(String(params?.skuId ?? ''))
  const qc = useQueryClient()

  const [recvOpen, setRecvOpen] = useState(false)
  const [xferOpen, setXferOpen] = useState(false)

  const [recvWh, setRecvWh] = useState('')
  const [recvQty, setRecvQty] = useState(1)
  const [recvCost, setRecvCost] = useState('0')
  const [recvBatch, setRecvBatch] = useState('')
  const [recvPo, setRecvPo] = useState('')

  const [xferFrom, setXferFrom] = useState('')
  const [xferTo, setXferTo] = useState('')
  const [xferQty, setXferQty] = useState(1)
  const [xferBatchId, setXferBatchId] = useState('')

  const skuQ = useQuery({
    queryKey: ['skus', skuId],
    enabled: !!skuId,
    queryFn: () => api.get<Sku>(`/skus/${encodeURIComponent(skuId)}`),
  })

  const levelsQ = useQuery({
    queryKey: ['inventory', 'levels', skuId],
    enabled: !!skuId,
    queryFn: () => api.get<StockLevel[]>(`/inventory/levels?skuId=${encodeURIComponent(skuId)}`),
  })

  const ledgerQ = useQuery({
    queryKey: ['inventory', 'ledger', skuId, 'detail'],
    enabled: !!skuId,
    queryFn: () => api.get<LedgerRow[]>(`/inventory/ledger?skuId=${encodeURIComponent(skuId)}&limit=50`),
  })

  const warehousesQ = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get<WarehouseRow[]>('/warehouses'),
  })

  const whMap = new Map((warehousesQ.data ?? []).map((w) => [w.id, `${w.code} · ${w.name}`]))

  const xferBatchMeta = useMemo(() => {
    const rows = (levelsQ.data ?? []).filter((l) => l.warehouseId === xferFrom && l.quantityAvailable > 0)
    const batches = new Set<string>()
    let hasNonBatch = false
    for (const l of rows) {
      if (isNonBatchBatchId(l.batchId)) hasNonBatch = true
      else if (l.batchId) batches.add(l.batchId)
    }
    const batchList = [...batches].sort()
    return { hasNonBatch, batchList, batchKey: batchList.join('|') }
  }, [levelsQ.data, xferFrom])

  const sku = skuQ.data

  useEffect(() => {
    if (recvOpen && sku) {
      setRecvWh('')
      setRecvQty(1)
      setRecvCost(String(Number(sku.cost ?? 0)))
      setRecvBatch('')
      setRecvPo('')
    }
  }, [recvOpen, sku])

  useEffect(() => {
    if (xferOpen) {
      setXferFrom('')
      setXferTo('')
      setXferQty(1)
      setXferBatchId('')
    }
  }, [xferOpen])

  useEffect(() => {
    if (!xferFrom) {
      setXferBatchId('')
      return
    }
    if (xferBatchMeta.hasNonBatch) {
      setXferBatchId('')
      return
    }
    const b = xferBatchMeta.batchList
    if (b.length === 1) setXferBatchId(b[0])
    else if (b.length > 1) setXferBatchId((cur) => (cur && b.includes(cur) ? cur : b[0]))
    else setXferBatchId('')
  }, [xferFrom, xferBatchMeta.hasNonBatch, xferBatchMeta.batchKey, xferBatchMeta.batchList])

  const patchSku = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      await api.patch(`/skus/${encodeURIComponent(skuId)}`, patch)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['skus', skuId] }),
  })

  const receiveMut = useMutation({
    mutationFn: async () => {
      await api.post('/inventory/receive', {
        skuId,
        warehouseId: recvWh,
        quantity: recvQty,
        unitCost: Number(recvCost),
        batchId: recvBatch.trim() || undefined,
        poId: recvPo.trim() || undefined,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', 'levels', skuId] })
      void qc.invalidateQueries({ queryKey: ['inventory', 'ledger', skuId] })
      void qc.invalidateQueries({ queryKey: ['skus'] })
      setRecvOpen(false)
    },
  })

  const transferMut = useMutation({
    mutationFn: async () => {
      await api.post('/inventory/transfer', {
        skuId,
        fromWarehouseId: xferFrom,
        toWarehouseId: xferTo,
        quantity: xferQty,
        batchId: xferBatchId.trim() || undefined,
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', 'levels', skuId] })
      void qc.invalidateQueries({ queryKey: ['inventory', 'ledger', skuId] })
      void qc.invalidateQueries({ queryKey: ['skus'] })
      setXferOpen(false)
    },
  })

  const batchRows = (levelsQ.data ?? []).filter((l) => !isNonBatchBatchId(l.batchId))

  const xferNeedsExplicitBatch =
    !!xferFrom &&
    !xferBatchMeta.hasNonBatch &&
    xferBatchMeta.batchList.length > 0 &&
    !xferBatchId.trim()

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/admin/inventory" className="text-sm text-cosmos-accent hover:underline">
            ← Inventory
          </Link>
          {skuQ.isLoading ? (
            <div className="skeleton h-8 w-64 mt-2" />
          ) : skuQ.isError || !sku ? (
            <p className="text-red-400 mt-2">SKU not found</p>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-cosmos-white mt-2 font-display">{sku.name}</h1>
              <p className="font-mono text-sm text-cosmos-accent mt-1">{sku.code}</p>
              <div className="flex flex-wrap gap-3 mt-3 items-center">
                <span
                  className="text-xs px-2 py-1 rounded-lg"
                  style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}
                >
                  {sku.category}
                </span>
                <StatusBadge status={sku.isActive ? 'ACTIVE' : 'INACTIVE'} />
                {sku.isTobacco && (
                  <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--c-accent-dim)', color: 'var(--c-accent)' }}>
                    Tobacco
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        {sku && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost !text-sm"
              onClick={() => patchSku.mutate({ isActive: !sku.isActive })}
            >
              {sku.isActive ? 'Deactivate' : 'Activate'}
            </button>
            <button type="button" className="btn-primary !text-sm" onClick={() => setRecvOpen(true)}>
              Receive stock
            </button>
            <button type="button" className="btn-ghost !text-sm" onClick={() => setXferOpen(true)}>
              Transfer
            </button>
          </div>
        )}
      </div>

      {sku && (
        <>
          <div className="cosmos-card">
            <h3 className="text-cosmos-white font-semibold font-display mb-3">Stock by warehouse</h3>
            {levelsQ.isLoading ? (
              <div className="skeleton h-24 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <table className="cosmos-table">
                  <thead>
                    <tr>
                      <th>Location / batch</th>
                      <th>Warehouse</th>
                      <th>On hand</th>
                      <th>Reserved</th>
                      <th>Available</th>
                      <th>Reorder pt</th>
                      <th>Reorder qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(levelsQ.data ?? []).map((l) => (
                      <tr key={l.id}>
                        <td className="font-mono text-xs">
                          {l.locationId ?? '—'} {l.batchId ? `· ${l.batchId}` : ''}
                        </td>
                        <td className="text-sm">{whMap.get(l.warehouseId) ?? l.warehouseId.slice(-8)}</td>
                        <td>{l.quantityOnHand}</td>
                        <td>{l.quantityReserved}</td>
                        <td>{l.quantityAvailable}</td>
                        <td>{l.reorderPoint}</td>
                        <td>{l.reorderQty ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(levelsQ.data ?? []).length === 0 && !levelsQ.isLoading && (
              <p className="text-sm text-cosmos-text-3 py-4">No stock levels yet — receive or transfer stock in.</p>
            )}
          </div>

          {sku.isTobacco && (
            <div className="cosmos-card">
              <h3 className="text-cosmos-white font-semibold font-display mb-3">Batch tracking</h3>
              {batchRows.length === 0 ? (
                <p className="text-sm text-cosmos-text-3 py-2">No batch-tracked stock yet — receive with a batch id to track excise lots.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="cosmos-table">
                    <thead>
                      <tr>
                        <th>Batch</th>
                        <th>Warehouse</th>
                        <th>On hand</th>
                        <th>Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchRows.map((l) => (
                        <tr key={l.id}>
                          <td className="font-mono text-xs">{l.batchId}</td>
                          <td>{whMap.get(l.warehouseId) ?? l.warehouseId.slice(-8)}</td>
                          <td>{l.quantityOnHand}</td>
                          <td>{l.quantityAvailable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="cosmos-card">
            <h3 className="text-cosmos-white font-semibold font-display mb-3">Stock history</h3>
            {ledgerQ.isLoading ? (
              <div className="skeleton h-32 w-full" />
            ) : (
              <div className="overflow-x-auto">
                <table className="cosmos-table text-sm">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Warehouse</th>
                      <th>Location</th>
                      <th>Batch</th>
                      <th>Event</th>
                      <th>Delta</th>
                      <th>After</th>
                      <th>Unit cost</th>
                      <th>Ref</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledgerQ.data ?? []).map((e) => (
                      <tr key={e.id}>
                        <td className="text-cosmos-text-3 whitespace-nowrap">{new Date(e.occurredAt).toLocaleString()}</td>
                        <td className="font-mono text-xs">{whMap.get(e.warehouseId) ?? e.warehouseId.slice(-6)}</td>
                        <td className="font-mono text-xs">{e.locationId ?? '—'}</td>
                        <td className="font-mono text-xs">{e.batchId || '—'}</td>
                        <td className="font-mono text-xs">{e.eventType}</td>
                        <td className="font-mono" style={{ color: e.quantityDelta >= 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
                          {e.quantityDelta >= 0 ? '+' : ''}
                          {e.quantityDelta}
                        </td>
                        <td className="font-mono">{e.quantityAfter}</td>
                        <td className="font-mono text-xs">{Number(e.unitCost ?? 0).toFixed(4)}</td>
                        <td className="font-mono text-xs max-w-[100px] truncate">
                          {e.referenceType ?? '—'} {e.referenceId ? e.referenceId.slice(0, 8) : ''}
                        </td>
                        <td className="font-mono text-xs">{e.performedBy.slice(-8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <CosmosDialogModal
        open={recvOpen}
        onOpenChange={setRecvOpen}
        title="Receive stock"
        maxWidthClass="max-w-md"
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setRecvOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!recvWh || receiveMut.isPending}
              onClick={() => receiveMut.mutate()}
            >
              Receive
            </button>
          </div>
        }
      >
        <select className="cosmos-input mb-3" value={recvWh} onChange={(e) => setRecvWh(e.target.value)}>
          <option value="">Warehouse…</option>
          {(warehousesQ.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code}
            </option>
          ))}
        </select>
        <label className="text-xs text-cosmos-text-3">Quantity</label>
        <input type="number" className="cosmos-input mb-3" value={recvQty} onChange={(e) => setRecvQty(Math.max(1, +e.target.value))} />
        <label className="text-xs text-cosmos-text-3">Unit cost</label>
        <input type="number" step="0.01" className="cosmos-input mb-3" value={recvCost} onChange={(e) => setRecvCost(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">Batch id (optional)</label>
        <input className="cosmos-input mb-3 font-mono text-sm" value={recvBatch} onChange={(e) => setRecvBatch(e.target.value)} />
        <label className="text-xs text-cosmos-text-3">PO id (optional)</label>
        <input className="cosmos-input font-mono text-sm" value={recvPo} onChange={(e) => setRecvPo(e.target.value)} />
      </CosmosDialogModal>

      <CosmosDialogModal
        open={xferOpen}
        onOpenChange={setXferOpen}
        title="Transfer stock"
        maxWidthClass="max-w-md"
        footer={
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-ghost" onClick={() => setXferOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                !xferFrom ||
                !xferTo ||
                xferFrom === xferTo ||
                xferNeedsExplicitBatch ||
                transferMut.isPending
              }
              onClick={() => transferMut.mutate()}
            >
              Transfer
            </button>
          </div>
        }
      >
        <label className="text-xs text-cosmos-text-3">From</label>
        <select className="cosmos-input mb-3" value={xferFrom} onChange={(e) => setXferFrom(e.target.value)}>
          <option value="">…</option>
          {(warehousesQ.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code}
            </option>
          ))}
        </select>
        <label className="text-xs text-cosmos-text-3">To</label>
        <select className="cosmos-input mb-3" value={xferTo} onChange={(e) => setXferTo(e.target.value)}>
          <option value="">…</option>
          {(warehousesQ.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code}
            </option>
          ))}
        </select>
        {(xferBatchMeta.hasNonBatch || xferBatchMeta.batchList.length > 0) && (
          <>
            <label className="text-xs text-cosmos-text-3">Batch / lot</label>
            <select className="cosmos-input mb-3 font-mono text-sm" value={xferBatchId} onChange={(e) => setXferBatchId(e.target.value)}>
              {xferBatchMeta.hasNonBatch && <option value="">Non-batch (aggregated)</option>}
              {xferBatchMeta.batchList.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="text-xs text-cosmos-text-3">Quantity</label>
        <input type="number" className="cosmos-input" value={xferQty} onChange={(e) => setXferQty(Math.max(1, +e.target.value))} />
      </CosmosDialogModal>
    </div>
  )
}
