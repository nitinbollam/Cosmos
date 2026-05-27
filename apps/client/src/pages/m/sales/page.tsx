import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { axiosErr } from '@/lib/axios-error'

type Lead = { id: string; companyName: string; status: string; email?: string }
type Customer = { id: string; name: string; email?: string }
type Activity = {
  id: string
  type: string
  subject: string
  occurredAt: string
  customerId?: string | null
}

export default function SalesMobilePage() {
  const [tab, setTab] = useState<'leads' | 'customers' | 'activities'>('leads')
  const [leads, setLeads] = useState<Lead[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [err, setErr] = useState<string | null>(null)
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
        api.get<Lead[]>('/leads'),
        api.get<Customer[]>('/customers?pageSize=50'),
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
      await api.post('/leads', {
        companyName: leadForm.companyName.trim(),
        email: leadForm.email.trim() || undefined,
        status: 'NEW',
      })
      setLeadForm({ companyName: '', email: '' })
      await load()
    } catch (ex) {
      setErr(axiosErr(ex))
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
      <h1 style={{ fontFamily: 'var(--font-syne)', fontSize: '1.25rem' }}>Field sales</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['leads', 'customers', 'activities'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? 'btn-primary' : 'btn-ghost'}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {err && <p style={{ color: '#f87171', fontSize: 13 }}>{err}</p>}

      {tab === 'leads' && (
        <>
          <form onSubmit={(e) => void createLead(e)} className="cosmos-mobile-card" style={{ marginBottom: 12 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>New lead</strong>
            <input
              className="cosmos-input"
              placeholder="Company name"
              value={leadForm.companyName}
              onChange={(e) => setLeadForm((f) => ({ ...f, companyName: e.target.value }))}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <input
              className="cosmos-input"
              placeholder="Email (optional)"
              value={leadForm.email}
              onChange={(e) => setLeadForm((f) => ({ ...f, email: e.target.value }))}
              style={{ width: '100%', marginBottom: 8 }}
            />
            <button type="submit" className="btn-primary">
              Add lead
            </button>
          </form>
          {leads.map((l) => (
            <div key={l.id} className="cosmos-mobile-card">
              <strong>{l.companyName}</strong>
              <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>
                {l.status} {l.email ? `· ${l.email}` : ''}
              </p>
            </div>
          ))}
        </>
      )}

      {tab === 'customers' &&
        customers.map((c) => (
          <div key={c.id} className="cosmos-mobile-card">
            <strong>{c.name}</strong>
            {c.email && <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>{c.email}</p>}
          </div>
        ))}

      {tab === 'activities' && (
        <>
          <form onSubmit={(e) => void logActivity(e)} className="cosmos-mobile-card" style={{ marginBottom: 12 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Log activity</strong>
            <select
              className="cosmos-input"
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
              className="cosmos-input"
              value={activityForm.type}
              onChange={(e) => setActivityForm((f) => ({ ...f, type: e.target.value }))}
              style={{ width: '100%', marginBottom: 8 }}
            >
              <option value="CALL">Call</option>
              <option value="EMAIL">Email</option>
              <option value="NOTE">Note</option>
            </select>
            <input
              className="cosmos-input"
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
            <div key={a.id} className="cosmos-mobile-card">
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
