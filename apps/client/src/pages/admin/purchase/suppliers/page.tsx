import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminPageShell } from '@/components/admin/admin-page-shell'
import { EmptyState } from '@/components/cosmos/empty-state'
import { CosmosSheet } from '@/components/cosmos/radix-overlays'
import { api } from '@/lib/api-admin'
import { errMsg } from '@/hooks/use-tenant-metadata'

type Supplier = { id: string; name: string; code: string; email?: string | null; phone?: string | null }

export default function PurchaseSuppliersPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<Supplier[]>('/suppliers'),
  })

  const create = useMutation({
    mutationFn: () => api.post('/suppliers', { code, name, email: email || undefined, phone: phone || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['suppliers'] })
      setOpen(false)
      setCode('')
      setName('')
      setEmail('')
      setPhone('')
    },
  })

  return (
    <AdminPageShell
      title="Supplier"
      section="Purchase"
      description="Vendors you purchase inventory from."
      actions={<button type="button" className="btn-primary" onClick={() => setOpen(true)}>Add supplier</button>}
    >
      {suppliers.isLoading ? (
        <p style={{ color: 'var(--c-text-2)' }}>Loading…</p>
      ) : (suppliers.data?.length ?? 0) === 0 ? (
        <EmptyState icon="🏭" title="No suppliers" description="Add a supplier to create purchase orders." />
      ) : (
        <ul className="space-y-2">
          {suppliers.data?.map((s) => (
            <li key={s.id} className="rounded-xl px-4 py-3 flex justify-between gap-3" style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border-card)' }}>
              <div>
                <p className="font-semibold" style={{ color: 'var(--c-heading)' }}>{s.name}</p>
                <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>{s.code}{s.email ? ` · ${s.email}` : ''}</p>
              </div>
              <Link to="/admin/purchase/orders" className="btn-ghost text-sm self-center">View POs</Link>
            </li>
          ))}
        </ul>
      )}

      <CosmosSheet open={open} onOpenChange={setOpen} title="New supplier">
        <form className="p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
          <input className="cosmos-input w-full" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <input className="cosmos-input w-full" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="cosmos-input w-full" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="cosmos-input w-full" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {create.error ? <p className="text-sm" style={{ color: 'var(--c-danger)' }}>{errMsg(create.error)}</p> : null}
          <button type="submit" className="btn-primary w-full" disabled={create.isPending}>Create</button>
        </form>
      </CosmosSheet>
    </AdminPageShell>
  )
}
