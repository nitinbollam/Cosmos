'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'

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
      <Link href="/crm" className="text-sm inline-block" style={{ color: 'var(--c-text-2)' }}>
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
                <h1 className="text-2xl font-bold font-display text-cosmos-white">{c.name}</h1>
                <StatusBadge status={c.customerKind === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'BUSINESS'} />
              </div>
              <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>
                Since {new Date(c.createdAt).toLocaleDateString()}
              </p>
            </div>
            <button type="button" className="btn-primary" onClick={() => setActivityOpen(true)}>
              Log activity
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="cosmos-card space-y-2">
              <h3 className="font-display font-semibold" style={{ color: 'var(--c-heading)' }}>Contact</h3>
              <dl className="text-sm space-y-1">
                <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Email</dt><dd>{c.email ?? '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Phone</dt><dd>{c.phone ?? '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Tax ID</dt><dd className="font-mono text-xs">{c.taxId ?? '—'}</dd></div>
                {c.isLicensedTobacco ? (
                  <div className="flex justify-between gap-4"><dt style={{ color: 'var(--c-text-3)' }}>Tobacco license</dt><dd className="font-mono text-xs">{c.tobaccoLicenseNumber ?? '—'}</dd></div>
                ) : null}
              </dl>
            </div>
            <div className="cosmos-card space-y-3">
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
            <div className="cosmos-card">
              <h3 className="font-display font-semibold" style={{ color: 'var(--c-heading)' }}>Primary address</h3>
              <p className="text-sm mt-2" style={{ color: 'var(--c-text)' }}>
                {[c.primaryAddressLine1, [c.primaryCity, c.primaryState, c.primaryZip].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
              </p>
            </div>
          ) : null}

          <div className="cosmos-card overflow-x-auto">
            <h3 className="font-display font-semibold mb-3" style={{ color: 'var(--c-heading)' }}>Recent orders</h3>
            {orders.isLoading ? (
              <div className="skeleton h-20 w-full" />
            ) : (orders.data?.items?.length ?? 0) === 0 ? (
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No orders for this customer yet.</p>
            ) : (
              <table className="cosmos-table">
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
                      <td><Link href={`/orders/${o.id}`} style={{ color: 'var(--c-accent)' }} className="text-sm">View</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="cosmos-card">
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
          <div className="cosmos-card max-w-md w-full space-y-3">
            <h3 className="font-display font-bold" style={{ color: 'var(--c-heading)' }}>Log activity</h3>
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Type</label>
            <select className="cosmos-input" value={actType} onChange={(e) => setActType(e.target.value as typeof actType)}>
              <option value="CALL">Call</option>
              <option value="EMAIL">Email</option>
              <option value="NOTE">Note</option>
            </select>
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Subject *</label>
            <input className="cosmos-input" value={actSubject} onChange={(e) => setActSubject(e.target.value)} />
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Notes</label>
            <textarea className="cosmos-input min-h-[80px]" value={actBody} onChange={(e) => setActBody(e.target.value)} />
            <label className="text-xs" style={{ color: 'var(--c-text-3)' }}>Outcome</label>
            <input className="cosmos-input" value={actOutcome} onChange={(e) => setActOutcome(e.target.value)} />
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
