import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api-mobile'
import { OfflineBanner } from '@/components/mobile/offline-banner'
import { enqueueAction, readQueue } from '@/lib/offline-queue'
import { axiosErr } from '@/lib/axios-error'
import type { ReceiptBilling } from '@/lib/receipt-billing'
import type { ScanResult } from '@/components/scanner/types'
import { EMPTY_SCAN_LOG, recordScan, type ScanEntry } from '@/lib/receiving-scan-log'

// Lazy so the decode engine (~500kB) is fetched only when a picker actually
// opens the camera, keeping it out of the mobile app's initial bundle.
const BarcodeScannerSheet = lazy(() =>
  import('@/components/scanner/BarcodeScannerSheet').then((m) => ({
    default: m.BarcodeScannerSheet,
  })),
)

/** A purchase order that can be received against now, from the server. */
type OpenPo = {
  id: string
  number: string
  supplierName: string | null
  status: string
  openLines: number
  openUnits: number
  warehouseName: string | null
  openSessionId: string | null
}

type SessionRow = {
  id: string
  status: string
  poId: string | null
  poNumber: string | null
  createdAt: string
  _count?: { items: number }
}

type SessionDetail = {
  id: string
  status: string
  poId: string | null
  poNumber: string | null
  items: Array<{ id: string; skuId: string; skuCode: string | null; receivedQty: number; damagedQty: number | null; expectedQty: number | null }>
}

type ScanResponse = { receivedQty: number; expectedQty: number | null; skuCode?: string; skuName?: string }

const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS']
const SESSION_KEY = 'pleros.m.receiving.session'

function rememberSession(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(SESSION_KEY, id)
    else window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Storage can be blocked; the session then just isn't restored after a reload.
  }
}

function rememberedSession(): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

const card = {
  padding: '10px 12px',
  border: 'var(--border-width) solid var(--c-border-card)',
  borderRadius: 'var(--bento-radius-sm)',
  background: 'var(--c-surface)',
} as const

export default function ReceivingMobilePage() {
  const [poRef, setPoRef] = useState('')
  const [poSearch, setPoSearch] = useState('')
  const [openPos, setOpenPos] = useState<OpenPo[] | null>(null)
  const [openSessions, setOpenSessions] = useState<SessionRow[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [scan, setScan] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [msg, setMsg] = useState<string | null>(null)
  const [last, setLast] = useState<{ ok: boolean; text: string } | null>(null)
  const [scannerMode, setScannerMode] = useState<null | 'items' | 'po'>(null)
  const [completing, setCompleting] = useState(false)
  const [scanLog, setScanLog] = useState(EMPTY_SCAN_LOG)
  const { recent, failed, totals } = scanLog
  const nextId = useRef(0)

  const record = useCallback((entry: Omit<ScanEntry, 'id'>) => {
    const row = { ...entry, id: nextId.current++ }
    setScanLog((log) => recordScan(log, row))
  }, [])

  const openSession = useCallback((id: string | null) => {
    setSessionId(id)
    rememberSession(id)
    setDetail(null)
    setLast(null)
    setScanLog(EMPTY_SCAN_LOG)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api.get<SessionDetail>(`/wms/receiving/sessions/${id}`)
      if (!OPEN_STATUSES.includes(d.status)) {
        // Finished or cancelled elsewhere: nothing left to scan here.
        setSessionId(null)
        rememberSession(null)
        setMsg(d.status === 'CANCELLED' ? 'That session was cancelled.' : 'That session is already finished.')
        return
      }
      setDetail(d)
    } catch {
      // Offline or a hiccup: the scan screen still works, it just can't show line progress.
    }
  }, [])

  // Picking up where the phone left off: a reload or a locked screen must not lose the session.
  useEffect(() => {
    const id = rememberedSession()
    if (id) setSessionId(id)
  }, [])

  useEffect(() => {
    if (sessionId) void loadDetail(sessionId)
  }, [sessionId, loadDetail])

  // The start screen: purchase orders to receive and sessions already open.
  useEffect(() => {
    if (sessionId || !navigator.onLine) return
    const handle = window.setTimeout(() => {
      api
        .get<OpenPo[]>(`/wms/receiving/open-purchase-orders${poSearch.trim() ? `?q=${encodeURIComponent(poSearch.trim())}` : ''}`)
        .then(setOpenPos)
        .catch(() => setOpenPos([]))
    }, 250)
    return () => window.clearTimeout(handle)
  }, [sessionId, poSearch])

  useEffect(() => {
    if (sessionId || !navigator.onLine) return
    api
      .get<SessionRow[]>('/wms/receiving/sessions')
      .then((rows) => setOpenSessions(rows.filter((r) => OPEN_STATUSES.includes(r.status))))
      .catch(() => setOpenSessions([]))
  }, [sessionId])

  // `ref` is a PO id or number; null starts a receipt with no PO.
  async function startFor(ref: string | null) {
    setMsg(null)
    try {
      if (!navigator.onLine) {
        // A queued "start" can't hand back a session id, so the screen would sit with scanning
        // locked and a second tap online would open a duplicate session. Starting needs a
        // connection; scans after that still queue offline.
        setMsg("You're offline — connect to start a receiving session. Scans work offline once it has started.")
        return
      }
      const res = await api.post<{ id: string; resumed?: boolean; poNumber?: string }>('/wms/receiving/sessions', {
        purchaseOrderId: ref?.trim() || undefined,
      })
      openSession(res.id)
      const label = `#${res.id.slice(-8).toUpperCase()}`
      setMsg(
        res.resumed
          ? `Continuing the open session ${label}${res.poNumber ? ` for ${res.poNumber}` : ''}`
          : `Session ${label} started`,
      )
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
      const qty = Number(quantity)
      if (!Number.isInteger(qty) || qty < 1) {
        setLast({ ok: false, text: 'Enter a quantity of 1 or more before scanning.' })
        return
      }
      setMsg(null)

      if (!navigator.onLine) {
        enqueueAction('receiving_scan', { sessionId, code: value, quantity: qty })
        record({ code: value, status: 'queued', source, detail: `${qty} queued` })
        setLast({ ok: true, text: `Queued offline: ${value} × ${qty}` })
        return
      }

      try {
        const res = await api.post<ScanResponse>(`/wms/receiving/sessions/${sessionId}/scan`, { code: value, quantity: qty })
        const name = res.skuName ? `${res.skuName} (${res.skuCode ?? value})` : (res.skuCode ?? value)
        const progress = res.expectedQty != null ? `${res.receivedQty} of ${res.expectedQty}` : `${res.receivedQty} received`
        record({ code: value, status: 'sent', source, detail: `+${qty} → ${progress}` })
        setLast({ ok: true, text: `${name}: +${qty}, now ${progress}` })
        void loadDetail(sessionId)
      } catch (e) {
        const text = axiosErr(e)
        record({ code: value, status: 'error', source, detail: text })
        setLast({ ok: false, text })
      }
    },
    [sessionId, quantity, record, loadDetail],
  )

  // Finishing on the phone: posts the stock, updates the PO and creates the supplier bill.
  async function completeSession() {
    if (!sessionId) return
    if (!navigator.onLine) {
      setMsg("You're offline — connect to complete the session.")
      return
    }
    const queued = readQueue().filter(
      (a) => a.type === 'receiving_scan' && (a.payload as { sessionId?: string } | undefined)?.sessionId === sessionId,
    ).length
    if (queued > 0) {
      setMsg(`${queued} scan${queued === 1 ? ' is' : 's are'} still queued offline. Wait for them to send, then complete.`)
      return
    }
    setCompleting(true)
    setMsg(null)
    try {
      const res = await api.patch<ReceiptBilling & { status: string }>(
        `/wms/receiving/sessions/${sessionId}/complete`,
      )
      const done = res.status === 'DISCREPANCY' ? 'Receiving complete, with damaged units noted.' : 'Receiving complete.'
      setMsg(
        res.billError
          ? `${done} The supplier bill couldn't be created: ${res.billError}. Ask the office to use "Create bill" on the purchase order.`
          : done,
      )
      openSession(null)
      setPoRef('')
    } catch (e) {
      setMsg(axiosErr(e))
    } finally {
      setCompleting(false)
    }
  }

  function leaveSession() {
    openSession(null)
    setMsg('Session left open. Pick it from "Open sessions" to carry on.')
  }

  async function scanLine() {
    await submitCode(scan, 'manual')
    setScan('')
  }

  const onDetected = useCallback(
    (result: ScanResult) => {
      if (scannerMode === 'po') {
        setScannerMode(null)
        void startFor(result.rawValue)
        return
      }
      void submitCode(result.rawValue, result.source)
    },
    // startFor only reads state set before the scan; the scanner callback must stay stable while the camera runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [submitCode, scannerMode],
  )

  const totalScans = totals.sent + totals.queued + totals.error
  const sessionSummary = [
    `${totalScans} scans`,
    totals.queued ? `${totals.queued} queued` : null,
    totals.error ? `${totals.error} failed` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const failedList = failed.length > 0 && (
    <>
      <h2 style={{ fontSize: 13, margin: '12px 0 0', color: 'var(--c-danger)' }}>
        Not received{totals.error > failed.length ? ` (last ${failed.length} of ${totals.error})` : ''}
      </h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gap: 6 }}>
        {failed.map((r) => (
          <li key={r.id} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.code}</span>
            <span style={{ fontSize: 11, textAlign: 'right', color: 'var(--c-danger)' }}>{r.detail ?? 'failed'}</span>
          </li>
        ))}
      </ul>
    </>
  )

  const recentList = recent.length > 0 && (
    <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
      {recent.map((r) => (
        <li key={r.id} style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.code}</span>
          <span
            style={{
              fontSize: 11,
              textAlign: 'right',
              color: r.status === 'queued' ? 'var(--c-warning)' : 'var(--c-success)',
            }}
          >
            {`${r.detail ?? r.status} · ${r.source}`}
          </span>
        </li>
      ))}
    </ul>
  )

  const quantityField = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
      <label htmlFor="receiving-qty" style={{ fontSize: 13 }}>
        Quantity per scan
      </label>
      <button type="button" className="btn-primary" aria-label="One less" onClick={() => setQuantity(String(Math.max(1, (Number(quantity) || 1) - 1)))}>
        −
      </button>
      <input
        id="receiving-qty"
        className="pleros-input"
        inputMode="numeric"
        style={{ width: 72, textAlign: 'center' }}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
      />
      <button type="button" className="btn-primary" aria-label="One more" onClick={() => setQuantity(String((Number(quantity) || 0) + 1))}>
        +
      </button>
    </div>
  )

  // Scanning a PO to start: just the camera and the list.
  if (scannerMode === 'po' && !sessionId) {
    return (
      <div className="split-view">
        <Suspense fallback={null}>
          <BarcodeScannerSheet
            open
            variant="split"
            title="Scan the PO barcode"
            onDetected={onDetected}
            onClose={() => setScannerMode(null)}
            onError={(err) => setMsg(err.message)}
          />
        </Suspense>
        <div className="split-body">
          <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>Point the camera at the PO number barcode.</p>
          {msg && <p style={{ marginTop: 8, fontSize: 13 }}>{msg}</p>}
        </div>
      </div>
    )
  }

  // Scanning items: camera pane on top, the running scan list stays visible below it.
  if (scannerMode === 'items' && sessionId) {
    return (
      <div className="split-view">
        <Suspense fallback={null}>
          <BarcodeScannerSheet
            open
            variant="split"
            title="Scan to receive"
            continuous
            onDetected={onDetected}
            onClose={() => setScannerMode(null)}
            onError={(err) => setMsg(err.message)}
          />
        </Suspense>
        <div className="split-body">
          <p style={{ fontSize: 13, opacity: 0.8, margin: 0 }}>
            {detail?.poNumber ? `${detail.poNumber} · ` : ''}Session #{sessionId.slice(-8).toUpperCase()} · {sessionSummary}
          </p>
          {quantityField}
          <p style={{ fontSize: 12, opacity: 0.7, margin: '8px 0 0' }}>
            A label counts once while it stays in view, by the quantity above. To receive more with the same barcode,
            move the label out of view for a moment, then scan it again.
          </p>
          {last && <p style={{ marginTop: 8, fontSize: 13, color: last.ok ? 'var(--c-success)' : 'var(--c-danger)' }}>{last.text}</p>}
          {msg && <p style={{ marginTop: 8, fontSize: 13 }}>{msg}</p>}
          {failedList}
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
          <h2 style={{ fontSize: '1rem', marginTop: 12 }}>Purchase orders to receive</h2>
          <input
            className="pleros-input"
            placeholder="Search by PO number"
            aria-label="Search purchase orders"
            value={poSearch}
            onChange={(e) => setPoSearch(e.target.value)}
          />
          <button type="button" className="btn-primary" style={{ marginTop: 8, width: '100%' }} onClick={() => setScannerMode('po')}>
            Scan a PO barcode
          </button>
          {openPos === null ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>
          ) : openPos.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>No purchase orders are waiting to be received.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
              {openPos.map((po) => (
                <li key={po.id}>
                  <button
                    type="button"
                    onClick={() => void startFor(po.id)}
                    style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>{po.number}</strong>
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>
                      {po.supplierName ?? 'No supplier'} · {po.openUnits} unit{po.openUnits === 1 ? '' : 's'} on {po.openLines} line
                      {po.openLines === 1 ? '' : 's'}
                      {po.warehouseName ? ` · ${po.warehouseName}` : ''}
                    </span>
                    {po.openSessionId && <span style={{ fontSize: 12, color: 'var(--c-warning)' }}>Session open: tap to continue</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ fontSize: '1rem', marginTop: 20 }}>Open sessions</h2>
          {openSessions.length === 0 ? (
            <p style={{ fontSize: 13, opacity: 0.7 }}>No sessions are open.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 8 }}>
              {openSessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      openSession(s.id)
                      setMsg(`Continuing the open session #${s.id.slice(-8).toUpperCase()}${s.poNumber ? ` for ${s.poNumber}` : ''}`)
                    }}
                    style={{ ...card, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <strong style={{ fontFamily: 'var(--font-mono)' }}>#{s.id.slice(-8).toUpperCase()}</strong>{' '}
                    {s.poNumber ?? 'No purchase order'}
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.8 }}>
                      {s._count?.items ?? 0} line{(s._count?.items ?? 0) === 1 ? '' : 's'} · started {new Date(s.createdAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ fontSize: '1rem', marginTop: 20 }}>Other ways to start</h2>
          <label htmlFor="receiving-po" style={{ display: 'block', fontSize: 13, marginTop: 4 }}>
            PO number
          </label>
          <input
            id="receiving-po"
            className="pleros-input"
            placeholder="e.g. PO-1001"
            value={poRef}
            onChange={(e) => setPoRef(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 8 }}
            disabled={!poRef.trim()}
            onClick={() => void startFor(poRef)}
          >
            Start session for this PO
          </button>
          <button type="button" className="btn-primary" style={{ marginTop: 8, marginLeft: 8 }} onClick={() => void startFor(null)}>
            Receive without a PO
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, opacity: 0.8 }}>
            {detail?.poNumber ? <strong>{detail.poNumber}</strong> : 'No purchase order'} · Session{' '}
            <strong style={{ fontFamily: 'var(--font-mono)' }}>#{sessionId.slice(-8).toUpperCase()}</strong>
          </p>
          {detail && detail.items.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px', display: 'grid', gap: 6 }}>
              {detail.items.map((it) => (
                <li key={it.id} style={{ ...card, display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{it.skuCode ?? it.skuId.slice(-6)}</span>
                  <span>
                    {it.receivedQty}
                    {it.expectedQty != null ? ` of ${it.expectedQty}` : ''}
                    {(it.damagedQty ?? 0) > 0 ? ` (${it.damagedQty} damaged)` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {quantityField}
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 12, width: '100%', minHeight: 56 }}
            onClick={() => setScannerMode('items')}
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
          {last && <p style={{ marginTop: 8, fontSize: 13, color: last.ok ? 'var(--c-success)' : 'var(--c-danger)' }}>{last.text}</p>}
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 16, width: '100%', minHeight: 48 }}
            disabled={completing}
            onClick={() => void completeSession()}
          >
            {completing ? 'Completing…' : 'Complete receiving'}
          </button>
          <button type="button" className="btn-primary" style={{ marginTop: 8, width: '100%' }} onClick={leaveSession}>
            Leave session open
          </button>
          {failedList}
          {recentList}
        </>
      )}
      {msg && <p style={{ marginTop: 12, fontSize: 13 }}>{msg}</p>}
    </div>
  )
}
