import { Link, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { currentIdentity } from '@/lib/session-identity'
import { creditLabel, leadAction, LEAD_STATUSES, money, type CreditView } from '@/lib/rep-app'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { axiosErr } from '@/lib/axios-error'

type Lead = { id: string; companyName: string; status: string; email?: string; assignedToUserId?: string | null; customerId?: string | null }
type Customer = { id: string; name: string; email?: string; city?: string | null; state?: string | null } & CreditView
type Activity = {
  id: string
  type: string
  subject: string
  occurredAt: string
  customerId?: string | null
}

export default function SalesMobilePage() {
  const [tab, setTab] = useState<'leads' | 'customers' | 'activities'>('customers')
  const [leads, setLeads] = useState<Lead[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busyLead, setBusyLead] = useState<string | null>(null)
  const navigate = useNavigate()
  const me = currentIdentity('mobile')?.userId ?? null
  const [leadForm, setLeadForm] = useState({ companyName: '', email: '' })
  const [activityForm, setActivityForm] = useState({
    customerId: '',
    type: 'CALL',
    subject: '',
  })

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [l, c, a] = await Promise.all([
        api.get<Lead[]>('/rep/leads'),
        api.get<Customer[]>('/rep/accounts'),
        api.get<Activity[]>('/activities'),
      ])
      setLeads(Array.isArray(l) ? l : [])
      setCustomers(Array.isArray(c) ? c : (c as { items?: Customer[] })?.items ?? [])
      setActivities(Array.isArray(a) ? a : [])
    } catch (e) {
      setErr(axiosErr(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createLead(e: React.FormEvent) {
    e.preventDefault()
    if (!leadForm.companyName.trim()) return
    try {
      await api.post('/rep/leads', {
        companyName: leadForm.companyName.trim(),
        email: leadForm.email.trim() || undefined,
      })
      setLeadForm({ companyName: '', email: '' })
      await load()
    } catch (ex) {
      setErr(axiosErr(ex))
    }
  }

  async function leadCall(id: string, fn: () => Promise<unknown>) {
    setBusyLead(id)
    setErr(null)
    try {
      await fn()
      await load()
    } catch (ex) {
      setErr(axiosErr(ex))
      await load()
    } finally {
      setBusyLead(null)
    }
  }

  async function convert(l: Lead) {
    setBusyLead(l.id)
    setErr(null)
    try {
      const done = await api.post<{ customerId: string }>(`/rep/leads/${l.id}/convert`, {})
      navigate(`/m/sales/customer/${done.customerId}`)
    } catch (ex) {
      setErr(axiosErr(ex))
      setBusyLead(null)
    }
  }

  async function logActivity(e: React.FormEvent) {
    e.preventDefault()
    if (!activityForm.customerId || !activityForm.subject.trim()) return
    try {
      await api.post('/activities', {
        customerId: activityForm.customerId,
        type: activityForm.type,
        subject: activityForm.subject.trim(),
        occurredAt: new Date().toISOString(),
      })
      setActivityForm({ customerId: '', type: 'CALL', subject: '' })
      await load()
      setTab('activities')
    } catch (ex) {
      setErr(axiosErr(ex))
    }
  }

  return (
    <div>
      <OfflineBanner />
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Field sales</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['customers', 'leads', 'activities'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTab(t)}
          >
            {t === 'customers' ? 'Accounts' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}

      {tab === 'leads' && (
        <>
          <form onSubmit={(e) => void createLead(e)} className="pleros-mobile-card" style={{ marginBottom: 12 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>New lead</strong>
            <input
              className="pleros-input"
              placeholder="Company name"
              value={leadForm.companyName}
              onChange={(e) => setLeadForm((f) => ({ ...f, companyName: e.target.value }))}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <input
              className="pleros-input"
              placeholder="Email (optional)"
              value={leadForm.email}
              onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <button type="submit" className="btn-primary">
              Add lead
            </button>
          </form>
          {leads.map((l) => {
            const act = leadAction(l, me)
            return (
              <div key={l.id} className="pleros-mobile-card">
                <strong>{l.companyName}</strong>
                <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>
                  {l.status} {l.email ? `· ${l.email}` : ''}
                </p>
                {act === 'claim' && (
                  <button type="button" className="btn-primary" style={{ marginTop: 8 }} disabled={busyLead === l.id}
                    onClick={() => void leadCall(l.id, () => api.post(`/rep/leads/${l.id}/claim`, {}))}>
                    Take this lead
                  </button>
                )}
                {act === 'work' && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select className="pleros-input" value={l.status} disabled={busyLead === l.id}
                      onChange={(e) => void leadCall(l.id, () => api.patch(`/rep/leads/${l.id}`, { status: e.target.value }))}>
                      {LEAD_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
                    </select>
                    <button type="button" className="btn-primary" disabled={busyLead === l.id} onClick={() => void convert(l)}>
                      Convert to account
                    </button>
                  </div>
                )}
                {l.customerId && (
                  <Link to={`/m/sales/customer/${l.customerId}`} className="pleros-shop-link-accent" style={{ fontSize: 13 }}>Open account</Link>
                )}
              </div>
            )
          })}
        </>
      )}

      {tab === 'customers' && (
        <>
          <input className="pleros-input" placeholder="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
          {customers.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())).map((c) => (
            <Link key={c.id} to={`/m/sales/customer/${c.id}`} className="pleros-mobile-card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{c.name}</strong>
                <span style={{ fontSize: 12, opacity: 0.8 }}>{c.openBalance > 0 ? `Owes ${money(c.openBalance)}` : 'Paid up'}</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>
                {[c.city, c.state].filter(Boolean).join(', ') || c.email || ' '} · {creditLabel(c)}
              </p>
            </Link>
          ))}
          {customers.length === 0 && !err && <p style={{ opacity: 0.6, textAlign: 'center' }}>No accounts assigned to you yet. Convert a lead to start.</p>}
        </>
      )}

      {tab === 'activities' && (
        <>
          <form onSubmit={(e) => void logActivity(e)} className="pleros-mobile-card" style={{ marginBottom: 12 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Log activity</strong>
            <select
              className="pleros-input"
              value={activityForm.customerId}
              onChange={(e) => setActivityForm((f) => ({ ...f, customerId: e.target.value }))}
              style={{ width: '100%', marginBottom: 8 }}
            >
              <option value="">Select customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="pleros-input"
              value={activityForm.type}
              onChange={(e) => setActivityForm((f) => ({ ...f, type: e.target.value }))}
              style={{ width: '100%', marginBottom: 8 }}
            >
              <option value="CALL">Call</option>
              <option value="EMAIL">Email</option>
              <option value="NOTE">Note</option>
            </select>
            <input
              className="pleros-input"
              placeholder="Subject"
              value={activityForm.subject}
              onChange={(e) => setActivityForm((f) => ({ ...f, subject: e.target.value }))}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <button type="submit" className="btn-primary">
              Save
            </button>
          </form>
          {activities.slice(0, 30).map((a) => (
            <div key={a.id} className="pleros-mobile-card">
              <strong>{a.subject}</strong>
              <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>
                {a.type} · {new Date(a.occurredAt).toLocaleString()}
              </p>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
