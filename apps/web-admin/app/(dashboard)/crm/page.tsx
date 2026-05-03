'use client'

import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Card, CardTitle } from '@cosmos/ui'
import { api } from '@/lib/api'
import { StatusBadge } from '@/components/cosmos/status-badge'
import { EmptyState } from '@/components/cosmos/empty-state'

type LeadRow = {
  id: string
  companyName: string
  email?: string | null
  status: string
  customer?: { id: string; name: string } | null
}

type CustomerRow = { id: string; name: string; email?: string | null; phone?: string | null }

type ActivityRow = {
  id: string
  type: string
  subject?: string | null
  body?: string | null
  customerId?: string | null
  leadId?: string | null
  occurredAt: string
}

type LeadStatusFilter = '' | 'OPEN' | 'CONVERTED' | 'LOST'

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const m = (e as { response?: { data?: { message?: unknown } } }).response?.data?.message
    if (Array.isArray(m)) return m.join(', ')
    if (typeof m === 'string') return m
  }
  if (e instanceof Error) return e.message
  return 'Request failed'
}

export default function CrmPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'leads' | 'customers' | 'activity'>('leads')

  const leadsQ = useQuery<LeadRow[]>({
    queryKey: ['leads'],
    queryFn: () => api.get('/leads'),
    enabled: tab === 'leads' || tab === 'activity',
  })

  const customersQ = useQuery<CustomerRow[]>({
    queryKey: ['customers'],
    queryFn: () => api.get('/customers'),
    enabled: tab === 'customers' || tab === 'activity',
  })

  const activitiesQ = useQuery<ActivityRow[]>({
    queryKey: ['activities'],
    queryFn: () => api.get('/activities'),
    enabled: tab === 'activity',
    refetchInterval: tab === 'activity' ? 60_000 : false,
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cosmos-white">CRM</h1>
          <p className="text-cosmos-muted text-sm mt-1">Leads, customers, and activities from crm-service.</p>
        </div>
        <div className="flex rounded-lg border border-cosmos-border overflow-hidden">
          {(
            [
              ['leads', 'Leads'],
              ['customers', 'Customers'],
              ['activity', 'Activity'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`px-4 py-2 text-sm ${tab === id ? 'bg-cosmos-primary text-white' : 'text-cosmos-text'}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'leads' && (
        <LeadsPanel
          leads={leadsQ.data ?? []}
          loading={leadsQ.isLoading}
          error={leadsQ.isError}
          onInvalidate={() => void qc.invalidateQueries({ queryKey: ['leads'] })}
        />
      )}

      {tab === 'customers' && (
        <CustomersPanel
          customers={customersQ.data ?? []}
          loading={customersQ.isLoading}
          error={customersQ.isError}
          onInvalidate={() => void qc.invalidateQueries({ queryKey: ['customers'] })}
        />
      )}

      {tab === 'activity' && (
        <ActivityPanel
          activities={activitiesQ.data ?? []}
          loading={activitiesQ.isLoading}
          error={activitiesQ.isError}
          customers={customersQ.data ?? []}
          leads={leadsQ.data ?? []}
          onInvalidate={() => void qc.invalidateQueries({ queryKey: ['activities'] })}
        />
      )}
    </div>
  )
}

function LeadsPanel(props: {
  leads: LeadRow[]
  loading: boolean
  error: boolean
  onInvalidate: () => void
}) {
  const qc = useQueryClient()
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [statusFilter, setStatusFilter] = useState<LeadStatusFilter>('')
  const [convertId, setConvertId] = useState<string | null>(null)
  const [convertName, setConvertName] = useState('')

  const filtered = useMemo(() => {
    if (!statusFilter) return props.leads
    return props.leads.filter((l) => l.status === statusFilter)
  }, [props.leads, statusFilter])

  const create = useMutation({
    mutationFn: () => api.post<LeadRow>('/leads', { companyName, email: email.trim() || undefined }),
    onSuccess: () => {
      setCompanyName('')
      setEmail('')
      void qc.invalidateQueries({ queryKey: ['leads'] })
    },
  })

  const convert = useMutation({
    mutationFn: ({ id, customerName }: { id: string; customerName: string }) =>
      api.post(`/leads/${encodeURIComponent(id)}/convert`, { customerName }),
    onSuccess: () => {
      setConvertId(null)
      setConvertName('')
      props.onInvalidate()
      void qc.invalidateQueries({ queryKey: ['customers'] })
      void qc.invalidateQueries({ queryKey: ['activities'] })
    },
  })

  const FILTERS: Array<{ label: string; value: LeadStatusFilter }> = [
    { label: 'All', value: '' },
    { label: 'Open', value: 'OPEN' },
    { label: 'Converted', value: 'CONVERTED' },
    { label: 'Lost', value: 'LOST' },
  ]

  return (
    <>
      <Card>
        <CardTitle>New lead</CardTitle>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 bg-cosmos-surface-2 border border-cosmos-border rounded-md px-3 h-10 text-sm text-cosmos-white"
            placeholder="Company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <input
            className="flex-1 bg-cosmos-surface-2 border border-cosmos-border rounded-md px-3 h-10 text-sm text-cosmos-white"
            placeholder="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="button"
            disabled={!companyName.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="h-10 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
          >
            {create.isPending ? 'Saving…' : 'Add lead'}
          </button>
        </div>
        {create.error && <p className="text-red-400 text-xs mt-2">{errMsg(create.error)}</p>}
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
              statusFilter === f.value
                ? 'border-cosmos-primary bg-cosmos-primary/20 text-cosmos-white'
                : 'border-cosmos-border text-cosmos-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardTitle>Leads</CardTitle>
        {props.loading ? (
          <p className="mt-4 text-cosmos-muted text-sm">Loading…</p>
        ) : props.error ? (
          <p className="mt-4 text-red-400 text-sm">Could not load leads.</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="📇"
            title="No leads"
            description={statusFilter ? 'No leads in this status.' : 'Add a lead or import from another channel.'}
          />
        ) : (
          <ul className="mt-4 divide-y divide-cosmos-border">
            {filtered.map((l) => (
              <li key={l.id} className="py-3 flex flex-wrap justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-cosmos-white font-medium">{l.companyName}</p>
                  {l.email && <p className="text-cosmos-muted text-sm">{l.email}</p>}
                  {l.customer && (
                    <Link
                      href={`/customers/${l.customer.id}`}
                      className="text-xs text-cosmos-primary hover:underline mt-1 inline-block"
                    >
                      Customer: {l.customer.name}
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={l.status} />
                  {l.status === 'OPEN' && (
                    <button
                      type="button"
                      onClick={() => {
                        setConvertId(l.id)
                        setConvertName(l.companyName)
                      }}
                      className="text-xs px-2 py-1 rounded border border-cosmos-border text-cosmos-text hover:bg-cosmos-surface-2"
                    >
                      Convert
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {convertId && (
        <div className="fixed inset-0 z-50 flex">
          <button type="button" className="flex-1 bg-black/60" aria-label="Close" onClick={() => setConvertId(null)} />
          <div className="w-full max-w-md bg-cosmos-surface border-l border-cosmos-border p-6">
            <h2 className="text-lg font-semibold text-cosmos-white">Convert lead</h2>
            <p className="text-xs text-cosmos-muted mt-1">Creates a customer and links the lead (admin role).</p>
            <label className="block mt-4 text-xs text-cosmos-muted">Customer / account name</label>
            <input
              className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
              value={convertName}
              onChange={(e) => setConvertName(e.target.value)}
            />
            {convert.error && <p className="text-red-400 text-xs mt-2">{errMsg(convert.error)}</p>}
            <div className="mt-6 flex gap-2">
              <button
                type="button"
                className="flex-1 h-10 rounded-md border border-cosmos-border text-cosmos-text text-sm"
                onClick={() => setConvertId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!convertName.trim() || convert.isPending}
                className="flex-1 h-10 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
                onClick={() => convert.mutate({ id: convertId, customerName: convertName.trim() })}
              >
                {convert.isPending ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CustomersPanel(props: {
  customers: CustomerRow[]
  loading: boolean
  error: boolean
  onInvalidate: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const create = useMutation({
    mutationFn: () => api.post('/customers', { name, email: email || undefined }),
    onSuccess: () => {
      setName('')
      setEmail('')
      props.onInvalidate()
    },
  })

  return (
    <>
      <Card>
        <CardTitle>New customer</CardTitle>
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 bg-cosmos-surface-2 border border-cosmos-border rounded-md px-3 h-10 text-sm text-cosmos-white"
            placeholder="Account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="flex-1 bg-cosmos-surface-2 border border-cosmos-border rounded-md px-3 h-10 text-sm text-cosmos-white"
            placeholder="Email (optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="button"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="h-10 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
          >
            {create.isPending ? 'Saving…' : 'Create'}
          </button>
        </div>
        {create.error && <p className="text-red-400 text-xs mt-2">{errMsg(create.error)}</p>}
      </Card>

      <Card>
        <CardTitle>Directory</CardTitle>
        {props.loading ? (
          <p className="text-cosmos-muted text-sm mt-3">Loading…</p>
        ) : props.error ? (
          <p className="text-red-400 text-sm mt-3">Could not load customers.</p>
        ) : props.customers.length === 0 ? (
          <EmptyState icon="🏢" title="No customers" description="Create a customer or convert a lead." />
        ) : (
          <ul className="mt-4 divide-y divide-cosmos-border">
            {props.customers.map((c) => (
              <li key={c.id} className="py-3 flex flex-wrap justify-between gap-4">
                <div>
                  <Link href={`/customers/${c.id}`} className="text-cosmos-white font-medium hover:text-cosmos-primary">
                    {c.name}
                  </Link>
                  <div className="text-xs text-cosmos-muted font-mono mt-0.5">{c.id.slice(-12)}…</div>
                </div>
                <div className="text-right text-sm text-cosmos-muted">
                  {c.email ?? '—'}
                  {c.phone ? <div>{c.phone}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function ActivityPanel(props: {
  activities: ActivityRow[]
  loading: boolean
  error: boolean
  customers: CustomerRow[]
  leads: LeadRow[]
  onInvalidate: () => void
}) {
  const [type, setType] = useState<'NOTE' | 'CALL' | 'EMAIL'>('NOTE')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [scope, setScope] = useState<'customer' | 'lead'>('customer')
  const [customerId, setCustomerId] = useState('')
  const [leadId, setLeadId] = useState('')

  const create = useMutation({
    mutationFn: () =>
      api.post('/activities', {
        type,
        subject: subject.trim() || undefined,
        body: body.trim() || undefined,
        ...(scope === 'customer'
          ? { customerId: customerId || undefined }
          : { leadId: leadId || undefined }),
      }),
    onSuccess: () => {
      setSubject('')
      setBody('')
      props.onInvalidate()
    },
  })

  const custLabel = useMemo(() => new Map(props.customers.map((c) => [c.id, c.name])), [props.customers])
  const leadLabel = useMemo(() => new Map(props.leads.map((l) => [l.id, l.companyName])), [props.leads])

  return (
    <>
      <Card>
        <CardTitle>Log activity</CardTitle>
        <p className="text-xs text-cosmos-muted mt-1">Requires a linked customer or lead.</p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-cosmos-muted">Type</label>
            <select
              className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="NOTE">Note</option>
              <option value="CALL">Call</option>
              <option value="EMAIL">Email</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-cosmos-muted">Related to</label>
            <select
              className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as 'customer' | 'lead')
              }}
            >
              <option value="customer">Customer</option>
              <option value="lead">Lead</option>
            </select>
          </div>
        </div>
        {scope === 'customer' ? (
          <div className="mt-3">
            <label className="text-xs text-cosmos-muted">Customer</label>
            <select
              className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Select…</option>
              {props.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="mt-3">
            <label className="text-xs text-cosmos-muted">Lead</label>
            <select
              className="mt-1 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
            >
              <option value="">Select…</option>
              {props.leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.companyName} ({l.status})
                </option>
              ))}
            </select>
          </div>
        )}
        <input
          className="mt-3 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          placeholder="Subject (optional)"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <textarea
          className="mt-2 w-full rounded-md bg-cosmos-surface-2 border border-cosmos-border px-3 py-2 text-sm text-cosmos-text"
          rows={3}
          placeholder="Details"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {create.error && <p className="text-red-400 text-xs mt-2">{errMsg(create.error)}</p>}
        <button
          type="button"
          disabled={
            create.isPending ||
            (scope === 'customer' ? !customerId : !leadId)
          }
          onClick={() => create.mutate()}
          className="mt-3 h-10 px-4 rounded-md bg-cosmos-primary text-white text-sm disabled:opacity-40"
        >
          {create.isPending ? 'Saving…' : 'Save activity'}
        </button>
      </Card>

      <Card>
        <CardTitle>Timeline</CardTitle>
        {props.loading ? (
          <p className="text-cosmos-muted text-sm mt-3">Loading…</p>
        ) : props.error ? (
          <p className="text-red-400 text-sm mt-3">Could not load activities.</p>
        ) : props.activities.length === 0 ? (
          <EmptyState
            icon="🗒️"
            title="No activities"
            description="Log calls, emails, or notes against a customer or lead."
          />
        ) : (
          <ul className="mt-4 space-y-3">
            {props.activities.map((a) => {
              const rel =
                a.customerId && custLabel.get(a.customerId)
                  ? `Customer · ${custLabel.get(a.customerId)}`
                  : a.leadId && leadLabel.get(a.leadId)
                    ? `Lead · ${leadLabel.get(a.leadId)}`
                    : '—'
              return (
                <li
                  key={a.id}
                  className="border border-cosmos-border rounded-lg p-3 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <StatusBadge status={a.type} />
                    <span className="text-cosmos-muted text-xs">
                      {new Date(a.occurredAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-cosmos-muted text-xs mt-2">{rel}</p>
                  {a.subject && <p className="text-cosmos-white font-medium mt-1">{a.subject}</p>}
                  {a.body && (
                    <p className="text-cosmos-text text-sm mt-1 whitespace-pre-wrap">{a.body}</p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
