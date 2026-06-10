import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-mobile'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { enqueueAction } from '@/lib/offline-queue'
import { axiosErr } from '@/lib/axios-error'

export default function ReceivingMobilePage() {
  const [poId, setPoId] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [scan, setScan] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  async function startSession() {
    setMsg(null)
    try {
      if (!navigator.onLine) {
        enqueueAction('receiving_session_create', { poId })
        setMsg('Queued offline — will sync when online')
        return
      }
      const res = await api.post<{ id: string }>('/wms/receiving/sessions', { purchaseOrderId: poId || undefined })
      setSessionId(res.id)
      setMsg(`Session ${res.id.slice(-8)} started`)
    } catch (e) {
      setMsg(axiosErr(e))
    }
  }

  async function scanLine() {
    if (!sessionId || !scan.trim()) return
    setMsg(null)
    try {
      if (!navigator.onLine) {
        enqueueAction('receiving_scan', { sessionId, code: scan.trim() })
        setScan('')
        setMsg('Scan queued offline')
        return
      }
      await api.post(`/wms/receiving/sessions/${sessionId}/scan`, { code: scan.trim(), quantity: 1 })
      setScan('')
      setMsg('Scanned')
    } catch (e) {
      setMsg(axiosErr(e))
    }
  }

  return (
    <div>
      <OfflineBanner />
      <Link to="/m/warehouse" className="cosmos-shop-link-accent" style={{ fontSize: 13 }}>
        ← Tasks
      </Link>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Receiving</h1>
      {!sessionId ? (
        <>
          <label style={{ display: 'block', fontSize: 13, marginTop: 12 }}>PO ID (optional)</label>
          <input className="cosmos-input" value={poId} onChange={(e) => setPoId(e.target.value)} />
          <button type="button" className="btn-primary" style={{ marginTop: 12 }} onClick={() => void startSession()}>
            Start session
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, opacity: 0.8 }}>Session {sessionId}</p>
          <input
            className="cosmos-input"
            placeholder="Scan barcode"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void scanLine()}
          />
          <button type="button" className="btn-primary" style={{ marginTop: 8 }} onClick={() => void scanLine()}>
            Add scan
          </button>
        </>
      )}
      {msg && <p style={{ marginTop: 12, fontSize: 13 }}>{msg}</p>}
    </div>
  )
}
