import { useState } from 'react'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { EmptyState } from '@/components/cosmos/empty-state'
import { errMsg, useTenantMe, useTenantMetadataPatch } from '@/hooks/use-tenant-metadata'
import { readMetadata, type TenantMetadata } from '@/lib/tenant-metadata'

type Promo = { id: string; code: string; label: string; discountPct: number; active: boolean }

export default function PromotionsPage() {
  const tenantQ = useTenantMe()
  const patch = useTenantMetadataPatch()
  const meta = readMetadata(tenantQ.data)
  const promos = meta.sales?.promotions ?? []

  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [discountPct, setDiscountPct] = useState('10')

  async function addPromo(e: React.FormEvent) {
    e.preventDefault()
    const next: Promo[] = [
      ...promos,
      {
        id: crypto.randomUUID(),
        code: code.trim().toUpperCase(),
        label: label.trim() || code.trim(),
        discountPct: Number(discountPct),
        active: true,
      },
    ]
    await patch.mutateAsync({ sales: { ...meta.sales, promotions: next } } as TenantMetadata)
    setCode('')
    setLabel('')
  }

  async function toggle(id: string) {
    const next = promos.map((p) => (p.id === id ? { ...p, active: !p.active } : p))
    await patch.mutateAsync({ sales: { ...meta.sales, promotions: next } } as TenantMetadata)
  }

  async function remove(id: string) {
    const next = promos.filter((p) => p.id !== id)
    await patch.mutateAsync({ sales: { ...meta.sales, promotions: next } } as TenantMetadata)
  }

  return (
    <AdminPageShell title="Promotion" section="Sales" description="Promo codes and discounts for sales channels.">
      <form onSubmit={(e) => void addPromo(e)} className="flex flex-wrap gap-2 mb-6">
        <input className="cosmos-input" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} required />
        <input className="cosmos-input" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="cosmos-input w-24" type="number" min={1} max={100} value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
        <button type="submit" className="btn-primary" disabled={patch.isPending}>Add promotion</button>
      </form>
      {patch.error ? <p className="text-sm mb-3" style={{ color: 'var(--c-danger)' }}>{errMsg(patch.error)}</p> : null}
      {promos.length === 0 ? (
        <EmptyState icon="🏷️" title="No promotions" description="Create a promo code above." />
      ) : (
        <ul className="space-y-2">
          {promos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>{p.code} · {p.discountPct}% off</p>
                <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>{p.label} · {p.active ? 'Active' : 'Inactive'}</p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost text-sm" onClick={() => void toggle(p.id)}>{p.active ? 'Deactivate' : 'Activate'}</button>
                <button type="button" className="btn-ghost text-sm" onClick={() => void remove(p.id)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminPageShell>
  )
}
