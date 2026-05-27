import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { api } from '@/lib/api-admin'
import { errMsg } from '@/hooks/use-tenant-metadata'

type Sku = { id: string; code: string; name: string }
type Warehouse = { id: string; name: string }

export default function PurchaseReturnsPage() {
  const [skuId, setSkuId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('Purchase return to supplier')
  const [ok, setOk] = useState(false)

  const skus = useQuery({ queryKey: ['skus-mini'], queryFn: () => api.get<{ items: Sku[] }>('/skus?page=1&pageSize=200').then((r) => r.items) })
  const warehouses = useQuery({ queryKey: ['warehouses'], queryFn: () => api.get<Warehouse[]>('/warehouses') })

  const adjust = useMutation({
    mutationFn: () =>
      api.post('/inventory/adjust', {
        skuId,
        warehouseId,
        quantityDelta: -Math.abs(Number(qty)),
        reason,
      }),
    onSuccess: () => setOk(true),
  })

  return (
    <AdminPageShell title="Purchase Return" section="Purchase" description="Return stock to supplier by reducing on-hand quantity.">
      <form className="max-w-md space-y-3 rounded-xl p-4" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }} onSubmit={(e) => { e.preventDefault(); setOk(false); adjust.mutate() }}>
        <select className="cosmos-input w-full" value={skuId} onChange={(e) => setSkuId(e.target.value)} required>
          <option value="">Select SKU</option>
          {skus.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
        </select>
        <select className="cosmos-input w-full" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
          <option value="">Warehouse</option>
          {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input className="cosmos-input w-full" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
        <input className="cosmos-input w-full" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" className="btn-primary" disabled={adjust.isPending}>Post return</button>
      </form>
      {ok ? <p className="text-sm mt-3" style={{ color: 'var(--c-success)' }}>Purchase return recorded (stock reduced).</p> : null}
      {adjust.error ? <p className="text-sm mt-3" style={{ color: 'var(--c-danger)' }}>{errMsg(adjust.error)}</p> : null}
    </AdminPageShell>
  )
}
