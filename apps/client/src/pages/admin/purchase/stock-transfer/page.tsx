import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'
import { errMsg } from '@/hooks/use-tenant-metadata'

type Sku = { id: string; code: string; name: string }
type Warehouse = { id: string; name: string }

export default function StockTransferPage() {
  const [skuId, setSkuId] = useState('')
  const [fromWarehouseId, setFromWarehouseId] = useState('')
  const [toWarehouseId, setToWarehouseId] = useState('')
  const [qty, setQty] = useState('1')
  const [ok, setOk] = useState(false)

  const skus = useQuery({ queryKey: ['skus-mini'], queryFn: () => api.get<{ items: Sku[] }>('/skus?page=1&pageSize=200').then((r) => r.items) })
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<Warehouse[]>('/warehouses') })

  const transfer = useMutation({
    mutationFn: () =>
      api.post('/inventory/transfer', {
        skuId,
        fromWarehouseId,
        toWarehouseId,
        quantity: Number(qty),
      }),
    onSuccess: () => setOk(true),
  })

  return (
    <AdminPageShell title="Stock Transfer" section="Purchase" description="Move inventory between warehouses.">
      <form className="max-w-md space-y-3 rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }} onSubmit={(e) => { e.preventDefault(); setOk(false); transfer.mutate() }}>
        <select className="cosmos-input w-full" value={skuId} onChange={(e) => setSkuId(e.target.value)} required>
          <option value="">Select SKU</option>
          {skus.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </select>
        <select className="cosmos-input w-full" value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} required>
          <option value="">From warehouse</option>
          {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select className="cosmos-input w-full" value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} required>
          <option value="">To warehouse</option>
          {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input className="cosmos-input w-full" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
        <button type="submit" className="btn-primary" disabled={transfer.isPending}>Transfer</button>
      </form>
      {ok ? <p className="text-sm mt-3" style={{ color: 'var(--c-success)' }}>Transfer completed.</p> : null}
      {transfer.error ? <p className="text-sm mt-3" style={{ color: 'var(--c-danger)' }}>{errMsg(transfer.error)}</p> : null}
    </AdminPageShell>
  )
}
