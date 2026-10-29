import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api-mobile'
import { axiosErr } from '@/lib/axios-error'
import { approvalSummary, isOwnRequisition, type ApprovalRow } from '@/lib/approval-summary'
import { getSessionUser } from '@/lib/auth-session'
import { isManager, tabsFor } from '@/lib/mobile-home'
import { readQueue } from '@/lib/offline-queue'

/** Home for managers, accounting and viewers: what is waiting for a decision, and a way into each area. */
export default function MobileHomePage() {
  const user = getSessionUser()
  const manager = isManager(user?.role)
  const [rows, setRows] = useState<ApprovalRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const queued = readQueue().length

  const load = useCallback(async () => {
    if (!manager) return
    try {
      setRows(await api.get<ApprovalRow[]>('/approvals?status=PENDING'))
    } catch (e) {
      setErr(axiosErr(e))
    }
  }, [manager])
  useEffect(() => {
    void load()
  }, [load])

  async function decide(id: string, approve: boolean) {
    if (!approve && reason.trim().length < 3) return setErr('Say why you are rejecting it')
    setBusy(id)
    setErr(null)
    try {
      await api.post(`/approvals/${encodeURIComponent(id)}/decide`, approve ? { approve: true } : { approve: false, rejectReason: reason.trim() })
      setRejecting(null)
      setReason('')
      await load()
    } catch (e) {
      setErr(axiosErr(e))
      await load()
    } finally {
      setBusy(null)
    }
  }

  const areas = tabsFor(user?.role, user?.permissions ?? []).filter((t) => t.href !== '/m/home')
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Home</h1>
      {err && <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p>}

      {manager && (
        <>
          <h2 style={{ fontSize: '1rem' }}>Waiting for you{rows.length ? ` (${rows.length})` : ''}</h2>
          {rows.map((a) => {
            const s = approvalSummary(a)
            return (
              <div key={a.id} className="pleros-mobile-card">
                <strong>{s.title}</strong>
                {s.detail && <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.8 }}>{s.detail}</p>}
                {isOwnRequisition(a, user?.sub) ? (
                  <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.75 }}>Your requisition: another manager or admin decides.</p>
                ) : rejecting === a.id ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    <input className="pleros-input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button type="button" className="btn-primary" disabled={busy === a.id} onClick={() => void decide(a.id, false)}>Reject</button>
                      <button type="button" className="btn-ghost" onClick={() => setRejecting(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" className="btn-primary" disabled={busy === a.id} onClick={() => void decide(a.id, true)}>Approve</button>
                    <button type="button" className="btn-ghost" disabled={busy === a.id} onClick={() => { setRejecting(a.id); setReason('') }}>Reject</button>
                  </div>
                )}
              </div>
            )
          })}
          {rows.length === 0 && !err && <p style={{ opacity: 0.6, fontSize: 13 }}>Nothing is waiting.</p>}
        </>
      )}

      {!manager && areas.length === 0 && (
        <p style={{ opacity: 0.75, fontSize: 14 }}>The mobile app is for field work. Use Pleros Admin on a computer for your tasks.</p>
      )}

      {areas.length > 0 && (
        <>
          <h2 style={{ fontSize: '1rem', marginTop: 20 }}>Areas</h2>
          {areas.map((t) => (
            <Link key={t.href} to={t.href} className="pleros-mobile-card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
              <strong>{t.label}</strong>
            </Link>
          ))}
        </>
      )}

      <Link to="/m/queue" className="pleros-mobile-card" style={{ display: 'block', color: 'inherit', textDecoration: 'none', marginTop: 12 }}>
        <strong>Unsent work</strong>
        <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>{queued === 0 ? 'Nothing waiting on this phone' : `${queued} on this phone`}</p>
      </Link>
    </div>
  )
}
