import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'
import { errMsg } from '@/hooks/use-tenant-metadata'

type PoLine = { id: string; lineNo: number; description: string; qtyOrdered: number; qtyReceived: number }
type PoDetail = { id: string; number: string; status: string; lines: PoLine[]; supplier?: { name: string } }
type Sku = { id: string; code: string; name: string; cost?: string | number }
type Warehouse = { id: string; name: string }

export default function PurchaseReceivePage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'po' | 'direct'>('po')
  const [poId, setPoId] = useState('')
  const [lineQty, setLineQty] = useState<Record<string, string>>({})
  const [skuId, setSkuId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [qty, setQty] = useState('1')
  const [unitCost, setUnitCost] = useState('0')
  const [msg, setMsg] = useState<string | null>(null)

  const pos = useQuery({ queryKey: ['purchase-orders'], queryFn: () => api.get<PoDetail[]>('/purchase-orders') })
  const poDetail = useQuery({
    queryKey: ['purchase-order', poId],
    queryFn: () => api.get<PoDetail>(`/purchase-orders/${poId}`),
    enabled: Boolean(poId),
  })
  const skus = useQuery({ queryKey: ['skus-mini'], queryFn: () => api.get<{ items: Sku[] }>('/skus?page=1&pageSize=200').then((r) => r.items) })
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<Warehouse[]>('/warehouses') })

  const receivePo = useMutation({
    mutationFn: () => {
      const lines = (poDetail.data?.lines ?? [])
        .map((line) => ({
          lineId: line.id,
          qtyReceived: Number(lineQty[line.id] ?? 0),
        }))
        .filter((l) => l.qtyReceived > 0)
      if (lines.length === 0) throw new Error('Enter qty to receive on at least one line')
      return api.post(`/purchase-orders/${poId}/receive`, { lines })
    },
    onSuccess: () => {
      setMsg('PO received')
      setLineQty({})
      void qc.invalidateQueries({ queryKey: ['purchase-orders'] })
      void qc.invalidateQueries({ queryKey: ['purchase-order', poId] })
    },
  })

  const receiveDirect = useMutation({
    mutationFn: () =>
      api.post('/inventory/receive', {
        skuId,
        warehouseId,
        quantity: Number(qty),
        unitCost: Number(unitCost),
        poId: poId || undefined,
      }),
    onSuccess: () => setMsg('Stock received into warehouse'),
  })

  const err = receivePo.error ?? receiveDirect.error

  return (
    <AdminPageShell title="Purchase Receive" section="Purchase" description="Receive goods against a PO or directly into stock.">
      <div className="flex gap-2 mb-4">
        <button type="button" className={tab === 'po' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('po')}>From PO</button>
        <button type="button" className={tab === 'direct' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('direct')}>Direct receive</button>
      </div>

      {tab === 'po' ? (
        <form className="max-w-lg space-y-3 rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }} onSubmit={(e) => { e.preventDefault(); receivePo.mutate() }}>
          <select className="cosmos-input w-full" value={poId} onChange={(e) => { setPoId(e.target.value); setLineQty({}) }} required>
            <option value="">Select purchase order</option>
            {pos.data?.filter((p) => p.status !== 'CANCELLED' && p.status !== 'CLOSED').map((p) => (
              <option key={p.id} value={p.id}>{p.number} · {p.supplier?.name ?? p.status}</option>
            ))}
          </select>
          {poDetail.data?.lines?.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--c-heading)' }}>Line quantities to receive</p>
              {poDetail.data.lines.map((line) => {
                const remaining = line.qtyOrdered - line.qtyReceived
                return (
                  <label key={line.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{line.lineNo}. {line.description} (remaining {remaining})</span>
                    <input
                      className="cosmos-input w-24"
                      type="number"
                      min={0}
                      max={remaining}
                      value={lineQty[line.id] ?? ''}
                      onChange={(e) => setLineQty((prev) => ({ ...prev, [line.id]: e.target.value }))}
                    />
                  </label>
                )
              })}
            </div>
          ) : null}
          <button type="submit" className="btn-primary" disabled={receivePo.isPending || !poId}>Receive PO</button>
          <Link to="/admin/purchase/orders" className="text-sm block" style={{ color: 'var(--c-accent)' }}>Open purchase orders →</Link>
        </form>
      ) : (
        <form className="max-w-md space-y-3 rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }} onSubmit={(e) => { e.preventDefault(); receiveDirect.mutate() }}>
          <select className="cosmos-input w-full" value={skuId} onChange={(e) => setSkuId(e.target.value)} required>
            <option value="">Select SKU</option>
            {skus.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
          <select className="cosmos-input w-full" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
            <option value="">Warehouse</option>
            {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input className="cosmos-input w-full" type="number" min={1} placeholder="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} required />
          <input className="cosmos-input w-full" type="number" min={0} step="0.01" placeholder="Unit cost" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} required />
          <button type="submit" className="btn-primary" disabled={receiveDirect.isPending}>Receive stock</button>
        </form>
      )}

      {msg ? <p className="text-sm mt-3" style={{ color: 'var(--c-success)' }}>{msg}</p> : null}
      {err ? <p className="text-sm mt-3" style={{ color: 'var(--c-danger)' }}>{errMsg(err)}</p> : null}
    </AdminPageShell>
  )
}
