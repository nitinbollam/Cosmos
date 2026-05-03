'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'

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
}

type LedgerRow = {
  id: string
  warehouseId: string
  eventType: string
  quantityDelta: number
  quantityAfter: number
  performedBy: string
  occurredAt: string
}

type WarehouseRow = { id: string; name: string; code: string }

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
        batchId: '',
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inventory', 'levels', skuId] })
      void qc.invalidateQueries({ queryKey: ['inventory', 'ledger', skuId] })
      void qc.invalidateQueries({ queryKey: ['skus'] })
      setXferOpen(false)
    },
  })

  const sku = skuQ.data

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/inventory" className="text-sm text-cosmos-accent hover:underline">
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
              <table className="cosmos-table">
                <thead>
                  <tr>
                    <th>Location / batch</th>
                    <th>Warehouse</th>
                    <th>On hand</th>
                    <th>Reserved</th>
                    <th>Available</th>
                    <th>Reorder</th>
                  </tr>
                </thead>
                <tbody>
                  {(levelsQ.data ?? []).map((l) => (
                    <tr key={l.id}>
                      <td className="font-mono text-xs">
                        {l.locationId ?? '—'} {l.batchId ? `· ${l.batchId.slice(0, 12)}` : ''}
                      </td>
                      <td className="text-sm">{whMap.get(l.warehouseId) ?? l.warehouseId.slice(-8)}</td>
                      <td>{l.quantityOnHand}</td>
                      <td>{l.quantityReserved}</td>
                      <td>{l.quantityAvailable}</td>
                      <td>{l.reorderPoint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(levelsQ.data ?? []).length === 0 && !levelsQ.isLoading && (
              <p className="text-sm text-cosmos-text-3 py-4">No stock levels yet — receive or transfer stock in.</p>
            )}
          </div>

          {sku.isTobacco && (levelsQ.data ?? []).some((l) => l.batchId) && (
            <div className="cosmos-card">
              <h3 className="text-cosmos-white font-semibold font-display mb-3">Batch positions</h3>
              <table className="cosmos-table">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Warehouse</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {(levelsQ.data ?? [])
                    .filter((l) => l.batchId)
                    .map((l) => (
                      <tr key={l.id}>
                        <td className="font-mono text-xs">{l.batchId}</td>
                        <td>{whMap.get(l.warehouseId) ?? l.warehouseId.slice(-8)}</td>
                        <td>{l.quantityOnHand}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="cosmos-card">
            <h3 className="text-cosmos-white font-semibold font-display mb-3">Stock history</h3>
            {ledgerQ.isLoading ? (
              <div className="skeleton h-32 w-full" />
            ) : (
              <table className="cosmos-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Event</th>
                    <th>Delta</th>
                    <th>After</th>
                    <th>Warehouse</th>
                    <th>By</th>
                  </tr>
                </thead>
                <tbody>
                  {(ledgerQ.data ?? []).map((e) => (
                    <tr key={e.id}>
                      <td className="text-sm text-cosmos-text-3">{new Date(e.occurredAt).toLocaleString()}</td>
                      <td className="font-mono text-xs">{e.eventType}</td>
                      <td className="font-mono" style={{ color: e.quantityDelta >= 0 ? 'var(--c-success)' : 'var(--c-danger)' }}>
                        {e.quantityDelta >= 0 ? '+' : ''}
                        {e.quantityDelta}
                      </td>
                      <td className="font-mono">{e.quantityAfter}</td>
                      <td className="font-mono text-xs">{e.warehouseId.slice(-6)}</td>
                      <td className="font-mono text-xs">{e.performedBy.slice(-8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {recvOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={() => setRecvOpen(false)}>
          <div className="cosmos-card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-3">Receive stock</h3>
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
            <input className="cosmos-input mb-4 font-mono text-sm" value={recvPo} onChange={(e) => setRecvPo(e.target.value)} />
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
          </div>
        </div>
      )}

      {xferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={() => setXferOpen(false)}>
          <div className="cosmos-card max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-cosmos-white font-display mb-3">Transfer stock</h3>
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
            <label className="text-xs text-cosmos-text-3">Quantity</label>
            <input type="number" className="cosmos-input mb-4" value={xferQty} onChange={(e) => setXferQty(Math.max(1, +e.target.value))} />
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn-ghost" onClick={() => setXferOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!xferFrom || !xferTo || xferFrom === xferTo || transferMut.isPending}
                onClick={() => transferMut.mutate()}
              >
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
