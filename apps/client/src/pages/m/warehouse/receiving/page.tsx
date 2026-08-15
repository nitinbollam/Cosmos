import { lazy, Suspense, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-mobile'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { enqueueAction } from '@/lib/offline-queue'
import { axiosErr } from '@/lib/axios-error'
import type { ScanResult } from '@/components/scanner/types'

// Lazy so the decode engine (~500kB) is fetched only when a picker actually
// opens the camera, keeping it out of the mobile app's initial bundle.
const BarcodeScannerSheet = lazy(() =>
  import('@/components/scanner/BarcodeScannerSheet').then((m) => ({
    default: m.BarcodeScannerSheet,
  })),
)

type ScanEntry = {
  code: string
  status: 'sent' | 'queued' | 'error'
  source: string
  detail?: string
}

export default function ReceivingMobilePage() {
  const [poId, setPoId] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [scan, setScan] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [recent, setRecent] = useState<ScanEntry[]>([])

  async function startSession() {
    setMsg(null)
    try {
      if (!navigator.onLine) {
        enqueueAction('receiving_session_create', { poId })
        setMsg('Queued offline — will sync when online')
        return
      }
      const res = await api.post<{ id: string }>('/wms/receiving/sessions', {
        purchaseOrderId: poId || undefined,
      })
      setSessionId(res.id)
      setMsg(`Session ${res.id.slice(-8)} started`)
    } catch (e) {
      setMsg(axiosErr(e))
    }
  }

  // Single submit path for every source — typed, camera, or scan gun — so
  // offline queueing and error handling stay identical across them.
  const submitCode = useCallback(
    async (code: string, source: string) => {
      const value = code.trim()
      if (!sessionId || !value) return
      setMsg(null)

      if (!navigator.onLine) {
        enqueueAction('receiving_scan', { sessionId, code: value })
        setRecent((prev) => [{ code: value, status: 'queued', source }, ...prev])
        setMsg('Scan queued offline')
        return
      }

      try {
        await api.post(`/wms/receiving/sessions/${sessionId}/scan`, { code: value, quantity: 1 })
        setRecent((prev) => [{ code: value, status: 'sent', source }, ...prev])
        setMsg('Scanned')
      } catch (e) {
        const detail = axiosErr(e)
        setRecent((prev) => [{ code: value, status: 'error', source, detail }, ...prev])
        setMsg(detail)
      }
    },
    [sessionId],
  )

  async function scanLine() {
    await submitCode(scan, 'manual')
    setScan('')
  }

  const onDetected = useCallback(
    (result: ScanResult) => {
      void submitCode(result.rawValue, result.source)
    },
    [submitCode],
  )

  const recentList = recent.length > 0 && (
    <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
      {recent.map((r, i) => (
        <li
          key={`${r.code}-${i}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 12px',
            border: 'var(--border-width) solid var(--c-border-card)',
            borderRadius: 'var(--bento-radius-sm)',
            background: 'var(--c-surface)',
          }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.code}</span>
          <span
            style={{
              fontSize: 11,
              color:
                r.status === 'error'
                  ? 'var(--c-danger)'
                  : r.status === 'queued'
                    ? 'var(--c-warning)'
                    : 'var(--c-success)',
            }}
          >
            {r.status === 'error' ? (r.detail ?? 'failed') : `${r.status} · ${r.source}`}
          </span>
        </li>
      ))}
    </ul>
  )

  // Scanning: camera pane on top, the running scan list stays visible below it.
  if (scannerOpen && sessionId) {
    return (
      <div className="split-view">
        <Suspense fallback={null}>
          <BarcodeScannerSheet
            open
            variant="split"
            title="Scan to receive"
            continuous
            onDetected={onDetected}
            onClose={() => setScannerOpen(false)}
            onError={(err) => setMsg(err.message)}
          />
        </Suspense>
        <div className="split-body">
          <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>
            Session {sessionId.slice(-8)} · {recent.length} scans
          </p>
          {msg && <p style={{ marginTop: 8, fontSize: 13 }}>{msg}</p>}
          {recentList}
        </div>
      </div>
    )
  }

  return (
    <div>
      <OfflineBanner />
      <Link to="/m/warehouse" className="pleros-shop-link-accent" style={{ fontSize: 13 }}>
        ← Tasks
      </Link>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem' }}>Receiving</h1>
      {!sessionId ? (
        <>
          <label style={{ display: 'block', fontSize: 13, marginTop: 12 }}>PO ID (optional)</label>
          <input className="pleros-input" value={poId} onChange={(e) => setPoId(e.target.value)} />
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => void startSession()}
          >
            Start session
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, opacity: 0.8 }}>Session {sessionId}</p>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 8, width: '100%', minHeight: 56 }}
            onClick={() => setScannerOpen(true)}
          >
            Scan with camera
          </button>
          <label style={{ display: 'block', fontSize: 13, marginTop: 16 }}>
            Or enter / scan a code
          </label>
          <input
            className="pleros-input"
            placeholder="Scan barcode"
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void scanLine()}
          />
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 8 }}
            onClick={() => void scanLine()}
          >
            Add scan
          </button>
          {recentList}
        </>
      )}
      {msg && <p style={{ marginTop: 12, fontSize: 13 }}>{msg}</p>}
    </div>
  )
}
