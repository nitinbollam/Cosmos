import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api-admin'
import { adminPath } from '@/lib/admin-path'
import { StatusBadge } from '@/components/pleros/status-badge'

type Customer = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  externalRef?: string | null
  customerKind?: string | null
  firstName?: string | null
  lastName?: string | null
  taxId?: string | null
  isLicensedTobacco?: boolean | null
  tobaccoLicenseNumber?: string | null
  creditLimit?: string | number | null
  creditUsed?: string | number | null
  paymentTermsDays?: number | null
  salesRepUserId?: string | null
  primaryAddressLine1?: string | null
  primaryCity?: string | null
  primaryState?: string | null
  primaryZip?: string | null
  createdAt: string
}

type ActivityRow = {
  id: string
  type: string
  subject?: string | null
  body?: string | null
  outcome?: string | null
  occurredAt: string
}

type OrderRow = {
  id: string
  status: string
  totalAmount: string | number
  createdAt: string
}

type OrderList = { items: OrderRow[] }

type UserRow = { id: string; email: string; firstName?: string | null; lastName?: string | null }

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

function money(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function userLabel(u: UserRow) {
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ')
  return n || u.email
}

const TYPE_ICON: Record<string, string> = { CALL: '📞', EMAIL: '✉️', NOTE: '📝' }

export default function CrmCustomerDetailPage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : params.id?.[0] ?? ''
  const qc = useQueryClient()

  const [activityOpen, setActivityOpen] = useState(false)
  const [actType, setActType] = useState<'CALL' | 'EMAIL' | 'NOTE'>('CALL')
  const [actSubject, setActSubject] = useState('')
  const [actBody, setActBody] = useState('')
  const [actOutcome, setActOutcome] = useState('')

  const [priceSkuId, setPriceSkuId] = useState('')
  const [priceAmount, setPriceAmount] = useState('')
  const [priceNotes, setPriceNotes] = useState('')

  const [volSkuId, setVolSkuId] = useState('')
  const [volMinQty, setVolMinQty] = useState('10')
  const [volPrice, setVolPrice] = useState('')

  const customer = useQuery<Customer>({
    queryKey: ['customer', id],
    queryFn: () => api.get(`/customers/${encodeURIComponent(id)}`),
    enabled: !!id,
  })

  const activities = useQuery<ActivityRow[]>({
    queryKey: ['activities', 'customer', id],
    queryFn: () => api.get(`/activities?customerId=${encodeURIComponent(id)}`),
    enabled: !!id,
  })

  const orders = useQuery<OrderList>({
    queryKey: ['orders', 'customer', id],
    queryFn: () => api.get(`/orders?customerId=${encodeURIComponent(id)}&page=1&pageSize=10`),
    enabled: !!id,
  })

  type ContractPrice = {
    id: string
    skuId: string
    unitPrice: string | number
    notes?: string | null
    sku?: { code: string; name: string; price: string | number } | null
    listPrice?: string | number | null
  }

  const contractPrices = useQuery<ContractPrice[]>({
    queryKey: ['customer-prices', id],
    queryFn: () => api.get(`/customers/${encodeURIComponent(id)}/prices`),
    enabled: !!id,
  })

  type VolumeBreak = {
    id: string
    skuId: string
    customerId?: string | null
    minQty: number
    unitPrice: string | number
  }

  const volumeBreaks = useQuery<VolumeBreak[]>({
    queryKey: ['volume-prices', id],
    queryFn: () => api.get(`/volume-prices?customerId=${encodeURIComponent(id)}`),
    enabled: !!id,
  })

  const savePrice = useMutation({
    mutationFn: () =>
      api.post(`/customers/${encodeURIComponent(id)}/prices`, {
        skuId: priceSkuId.trim(),
        unitPrice: Number.parseFloat(priceAmount),
        notes: priceNotes.trim() || undefined,
      }),
    onSuccess: () => {
      setPriceSkuId('')
      setPriceAmount('')
      setPriceNotes('')
      void qc.invalidateQueries({ queryKey: ['customer-prices', id] })
    },
  })

  const deletePrice = useMutation({
    mutationFn: (skuId: string) => api.delete(`/customers/${encodeURIComponent(id)}/prices/${encodeURIComponent(skuId)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['customer-prices', id] }),
  })

  const saveVolumeBreak = useMutation({
    mutationFn: () =>
      api.post('/volume-prices', {
        skuId: volSkuId.trim(),
        customerId: id,
        minQty: Number.parseInt(volMinQty, 10),
        unitPrice: Number.parseFloat(volPrice),
      }),
    onSuccess: () => {
      setVolSkuId('')
      setVolMinQty('10')
      setVolPrice('')
      void qc.invalidateQueries({ queryKey: ['volume-prices', id] })
    },
  })

  const salesRep = useQuery<UserRow | null>({
    queryKey: ['user', customer.data?.salesRepUserId],
    queryFn: async () => {
      const rid = customer.data?.salesRepUserId
      if (!rid) return null
      try {
        return await api.get<UserRow>(`/users/${encodeURIComponent(rid)}`)
      } catch {
        return null
      }
    },
    enabled: !!customer.data?.salesRepUserId,
  })

  const [portalInviteUrl, setPortalInviteUrl] = useState<string | null>(null)
  const [portalLinkCopied, setPortalLinkCopied] = useState(false)
  const portalInvite = useMutation({
    mutationFn: () =>
      api.post<{ inviteUrl?: string }>('/tenants/me/invites', {
        email: customer.data?.email,
        role: 'STAFF',
      }),
    onSuccess: (res) => {
      setPortalLinkCopied(false)
      setPortalInviteUrl(res?.inviteUrl ?? null)
    },
  })

  const addActivity = useMutation({
    mutationFn: () =>
      api.post('/activities', {
        type: actType,
        subject: actSubject.trim() || undefined,
        body: actBody.trim() || undefined,
        outcome: actOutcome.trim() || undefined,
        customerId: id,
      }),
    onSuccess: () => {
      setActivityOpen(false)
      setActSubject('')
      setActBody('')
      setActOutcome('')
      void qc.invalidateQueries({ queryKey: ['activities', 'customer', id] })
      void qc.invalidateQueries({ queryKey: ['activities'] })
    },
  })

  if (!id) return null

  const c = customer.data
  const limit = c?.creditLimit != null ? Number(c.creditLimit) : 0
  const used = c?.creditUsed != null ? Number(c.creditUsed) : 0
  const available = Math.max(0, limit - used)
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0
  let barColor = 'var(--c-success)'
  if (pct >= 80) barColor = 'var(--c-danger)'
  else if (pct >= 60) barColor = 'var(--c-warning)'

  return (
    <div className="p-6 space-y-6" style={{ fontFamily: 'var(--font-body)' }}>
      <Link to="/admin/crm" className="text-sm inline-block" style={{ color: 'var(--c-text-2)' }}>
        ← CRM
      </Link>

      {customer.isLoading ? (
        <div className="skeleton h-24 w-full" />
      ) : customer.error || !c ? (
        <p style={{ color: 'var(--c-danger)' }}>Customer not found</p>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold font-display text-pleros-white">{c.name}</h1>
                <StatusBadge status={c.customerKind === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS'} />
              </div>
              <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
                Since {new Date(c.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {c.email ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={portalInvite.isPending}
                  onClick={() => portalInvite.mutate()}
                >
                  {portalInvite.isPending ? 'Inviting…' : 'Invite to buyer portal'}
                </button>
              ) : null}
              <button type="button" className="btn-primary" onClick={() => setActivityOpen(true)}>
                Log activity
              </button>
            </div>
          </div>

          {portalInvite.error ? (
            <p className="text-sm" style={{ color: 'var(--c-danger)' }}>{errMsg(portalInvite.error)}</p>
          ) : null}
          {portalInviteUrl ? (
            <div className="pleros-card" style={{ borderColor: 'var(--c-accent)' }}>
              <h3 className="font-display font-semibold" style={{ color: 'var(--c-heading)' }}>Buyer portal invite created</h3>
              <p className="text-sm mt-1 mb-3" style={{ color: 'var(--c-text-3)' }}>
                Sent to {c.email}. Share this link if email delivery isn&rsquo;t configured — shown once, expires in 7 days.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <code className="text-xs font-mono break-all px-3 py-2 rounded-lg" style={{ background: 'var(--c-surface-2)', color: 'var(--c-accent)' }}>
                  {portalInviteUrl}
                </code>
                <button
                  type="button"
                  className="btn-ghost !py-1 !px-3 !text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(portalInviteUrl).then(() => setPortalLinkCopied(true))
                  }}
                >
                  {portalLinkCopied ? 'Copied' : 'Copy'}
                </button>
                <button type="button" className="btn-ghost !py-1 !px-3 !text-xs" onClick={() => setPortalInviteUrl(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="pleros-card space-y-2">
              <h3 className="font-display font-semibold" style={{ color: 'var(--c-heading)' }}>Contact</h3>
              <dl className="text-sm space-y-1">
                <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Email</dt><dd>{c.email ?? '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Phone</dt><dd>{c.phone ?? '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Tax ID</dt><dd className="font-mono text-xs">{c.taxId ?? '—'}</dd></div>
                {c.isLicensedTobacco ? (
                  <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Tobacco license</dt><dd className="font-mono text-xs">{c.tobaccoLicenseNumber ?? '—'}</dd></div>
                ) : (
                  <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Tobacco license</dt><dd style={{ color: 'var(--c-text-3)' }}>Not licensed</dd></div>
                )}
              </dl>
              <LicenseEditor
                customerId={c.id}
                isLicensedTobacco={Boolean(c.isLicensedTobacco)}
                tobaccoLicenseNumber={c.tobaccoLicenseNumber ?? ''}
              />
            </div>
            <div className="pleros-card space-y-3">
              <h3 className="font-display font-semibold" style={{ color: 'var(--c-heading)' }}>Credit</h3>
              {limit > 0 ? (
                <>
                  <div className="flex justify-between text-sm font-mono">
                    <span style={{ color: 'var(--c-text-2)' }}>Used</span>
                    <span style={{ color: 'var(--c-text)' }}>{money(used)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-mono">
                    <span style={{ color: 'var(--c-text-2)' }}>Limit</span>
                    <span>{money(limit)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-mono">
                    <span style={{ color: 'var(--c-text-2)' }}>Available</span>
                    <span style={{ color: available < limit * 0.2 ? 'var(--c-warning)' : 'var(--c-accent)' }}>{money(available)}</span>
                  </div>
                  <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--c-surface-2)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: barColor }} />
                  </div>
                </>
              ) : (
                <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No credit limit on file.</p>
              )}
              <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Payment terms: {c.paymentTermsDays ?? 0} days</p>
              {salesRep.data ? <p className="text-xs" style={{ color: 'var(--c-text-2)' }}>Sales rep: {userLabel(salesRep.data)}</p> : null}
            </div>
          </div>

          {(c.primaryAddressLine1 || c.primaryCity) ? (
            <div className="pleros-card">
              <h3 className="font-display font-semibold" style={{ color: 'var(--c-heading)' }}>Primary address</h3>
              <p className="text-sm mt-2" style={{ color: 'var(--c-text)' }}>
                {[c.primaryAddressLine1, [c.primaryCity, c.primaryState, c.primaryZip].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
              </p>
            </div>
          ) : null}

          <div className="pleros-card overflow-x-auto">
            <h3 className="font-display font-semibold mb-3" style={{ color: 'var(--c-heading)' }}>Contract pricing</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--c-text-3)' }}>
              Customer-specific SKU prices override list price in the B2B catalog and at checkout.
            </p>
            <div className="grid md:grid-cols-4 gap-2 mb-4">
              <input className="pleros-input" placeholder="SKU id" value={priceSkuId} onChange={(e) => setPriceSkuId(e.target.value)} />
              <input className="pleros-input" placeholder="Unit price" type="number" step="0.01" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} />
              <input className="pleros-input md:col-span-2" placeholder="Notes (optional)" value={priceNotes} onChange={(e) => setPriceNotes(e.target.value)} />
            </div>
            <button
              type="button"
              className="btn-primary mb-4"
              disabled={!priceSkuId.trim() || !priceAmount || savePrice.isPending}
              onClick={() => void savePrice.mutate()}
            >
              Save contract price
            </button>
            {contractPrices.isLoading ? (
              <div className="skeleton h-16 w-full" />
            ) : (contractPrices.data?.length ?? 0) === 0 ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No contract prices — catalog uses list price.</p>
            ) : (
              <table className="pleros-table">
                <thead>
                  <tr><th>SKU</th><th>List</th><th>Contract</th><th>Notes</th><th /></tr>
                </thead>
                <tbody>
                  {(contractPrices.data ?? []).map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="font-mono text-xs">{p.sku?.code ?? p.skuId.slice(0, 12)}</div>
                        <div className="text-xs" style={{ color: 'var(--c-text-3)' }}>{p.sku?.name ?? ''}</div>
                      </td>
                      <td className="font-mono">{p.listPrice != null ? money(Number(p.listPrice)) : '—'}</td>
                      <td className="font-mono" style={{ color: 'var(--c-accent)' }}>{money(Number(p.unitPrice))}</td>
                      <td className="text-sm" style={{ color: 'var(--c-text-2)' }}>{p.notes ?? '—'}</td>
                      <td>
                        <button type="button" className="btn-ghost !py-1 !px-2 !text-xs" onClick={() => void deletePrice.mutate(p.skuId)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="pleros-card overflow-x-auto">
            <h3 className="font-display font-semibold mb-3" style={{ color: 'var(--c-heading)' }}>Volume pricing</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--c-text-3)' }}>
              Tier breaks apply when order quantity meets minimum — overrides list price at checkout.
            </p>
            <div className="grid md:grid-cols-4 gap-2 mb-4">
              <input className="pleros-input" placeholder="SKU id" value={volSkuId} onChange={(e) => setVolSkuId(e.target.value)} />
              <input className="pleros-input" placeholder="Min qty" type="number" min={1} value={volMinQty} onChange={(e) => setVolMinQty(e.target.value)} />
              <input className="pleros-input" placeholder="Unit price" type="number" step="0.01" value={volPrice} onChange={(e) => setVolPrice(e.target.value)} />
              <button
                type="button"
                className="btn-primary"
                disabled={!volSkuId.trim() || !volPrice || saveVolumeBreak.isPending}
                onClick={() => void saveVolumeBreak.mutate()}
              >
                Add tier
              </button>
            </div>
            {volumeBreaks.isLoading ? (
              <div className="skeleton h-16 w-full" />
            ) : (volumeBreaks.data ?? []).filter((v) => v.customerId === id).length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No volume tiers for this customer.</p>
            ) : (
              <table className="pleros-table">
                <thead>
                  <tr><th>SKU</th><th>Min qty</th><th>Unit price</th></tr>
                </thead>
                <tbody>
                  {(volumeBreaks.data ?? [])
                    .filter((v) => v.customerId === id)
                    .map((v) => (
                      <tr key={v.id}>
                        <td className="font-mono text-xs">{v.skuId.slice(0, 14)}…</td>
                        <td>{v.minQty}+</td>
                        <td className="font-mono" style={{ color: 'var(--c-accent)' }}>{money(Number(v.unitPrice))}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="pleros-card overflow-x-auto">
            <h3 className="font-display font-semibold mb-3" style={{ color: 'var(--c-heading)' }}>Recent orders</h3>
            {orders.isLoading ? (
              <div className="skeleton h-20 w-full" />
            ) : (orders.data?.items?.length ?? 0) === 0 ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No orders for this customer yet.</p>
            ) : (
              <table className="pleros-table">
                <thead>
                  <tr><th>Order</th><th>Date</th><th>Total</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {(orders.data?.items ?? []).map((o) => (
                    <tr key={o.id}>
                      <td className="font-mono text-xs">{o.id.slice(0, 14)}…</td>
                      <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                      <td className="font-mono">{money(Number(o.totalAmount))}</td>
                      <td><StatusBadge status={o.status} /></td>
                      <td><Link to={adminPath(`/orders/${o.id}`)} style={{ color: 'var(--c-accent)' }} className="text-sm">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="pleros-card">
            <h3 className="font-display font-semibold mb-3" style={{ color: 'var(--c-heading)' }}>Activity timeline</h3>
            {activities.isLoading ? (
              <div className="skeleton h-32 w-full" />
            ) : (activities.data?.length ?? 0) === 0 ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No activities yet.</p>
            ) : (
              <ul className="space-y-4 border-l pl-4 ml-2" style={{ borderColor: 'var(--c-border)' }}>
                {(activities.data ?? []).map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[21px] top-1 w-2 h-2 rounded-full" style={{ background: 'var(--c-primary)' }} />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg">{TYPE_ICON[a.type] ?? '📌'}</span>
                      <StatusBadge status={a.type} />
                      <span className="text-xs font-mono" style={{ color: 'var(--c-text-3)' }}>
                        {new Date(a.occurredAt).toLocaleString()}
                      </span>
                    </div>
                    {a.subject ? <p className="font-semibold mt-1" style={{ color: 'var(--c-text)' }}>{a.subject}</p> : null}
                    {a.body ? <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: 'var(--c-text-2)' }}>{a.body}</p> : null}
                    {a.outcome ? <p className="text-xs mt-1" style={{ color: 'var(--c-accent)' }}>Outcome: {a.outcome}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {activityOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div className="pleros-card max-w-md w-full space-y-3">
            <h3 className="font-display font-bold" style={{ color: 'var(--c-heading)' }}>Log activity</h3>
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Type</label>
            <select className="pleros-input" value={actType} onChange={(e) => setActType(e.target.value as typeof actType)}>
              <option value="CALL">Call</option>
              <option value="EMAIL">Email</option>
              <option value="NOTE">Note</option>
            </select>
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Subject *</label>
            <input className="pleros-input" value={actSubject} onChange={(e) => setActSubject(e.target.value)} />
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Notes</label>
            <textarea className="pleros-input min-h-[80px]" value={actBody} onChange={(e) => setActBody(e.target.value)} />
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Outcome</label>
            <input className="pleros-input" value={actOutcome} onChange={(e) => setActOutcome(e.target.value)} />
            {addActivity.error && <p className="text-sm" style={{ color: 'var(--c-danger)' }}>{errMsg(addActivity.error)}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" className="btn-ghost flex-1" onClick={() => setActivityOpen(false)}>Cancel</button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={!actSubject.trim() || addActivity.isPending}
                onClick={() => addActivity.mutate()}
              >
                {addActivity.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LicenseEditor(props: {
  customerId: string
  isLicensedTobacco: boolean
  tobaccoLicenseNumber: string
}) {
  const qc = useQueryClient()
  const [licensed, setLicensed] = useState(props.isLicensedTobacco)
  const [license, setLicense] = useState(props.tobaccoLicenseNumber)
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/customers/${encodeURIComponent(props.customerId)}`, {
        isLicensedTobacco: licensed,
        tobaccoLicenseNumber: licensed ? license.trim() || null : null,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['customer', props.customerId] }),
  })

  return (
    <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--c-border)' }}>
      <p className="text-xs font-medium" style={{ color: 'var(--c-text-2)' }}>
        Regulated product license
      </p>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={licensed} onChange={(e) => setLicensed(e.target.checked)} />
        Licensed for tobacco / age-restricted products
      </label>
      {licensed ? (
        <input
          className="pleros-input font-mono text-xs"
          placeholder="License number"
          value={license}
          onChange={(e) => setLicense(e.target.value)}
        />
      ) : null}
      <button
        type="button"
        className="btn-ghost !text-xs"
        disabled={save.isPending || (licensed && !license.trim())}
        onClick={() => save.mutate()}
      >
        {save.isPending ? 'Saving…' : 'Save license'}
      </button>
      {save.error ? (
        <p className="text-xs" style={{ color: 'var(--c-danger)' }}>
          {errMsg(save.error)}
        </p>
      ) : null}
      {save.isSuccess ? (
        <p className="text-xs" style={{ color: 'var(--c-accent)' }}>
          License updated.
        </p>
      ) : null}
    </div>
  )
}
