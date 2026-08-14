import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_ERROR_COPY,
  ScannerError,
  type BarcodeScannerProps,
  type ScanResult,
} from './types'
import { WAREHOUSE_DEFAULT_FORMATS } from './engines'
import { ScanDeduper } from './dedupe'
import { useScanner } from './useScanner'
import { useKeyboardWedge } from './useKeyboardWedge'
import { ScanFrameOverlay } from './ScanFrameOverlay'
import './scanner.css'

/** Short haptic + beep on a successful read. Best-effort, never throws. */
function signalHit() {
  try {
    navigator.vibrate?.(60)
  } catch {
    /* not supported */
  }
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.value = 0.05
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.09)
    osc.onended = () => ctx.close()
  } catch {
    /* audio blocked */
  }
}

/**
 * The drop-in scanner UI. Mobile-first, large touch targets, dark theme
 * (readable in dim aisles), camera + wedge + manual sources, torch, and
 * continuous/single modes.
 *
 * Two layouts share one implementation (see `variant`): a fullscreen "sheet"
 * for one-shot scans, and an in-flow "split" pane that lets the parent keep its
 * working list on screen while scanning. Both emit the same normalized
 * `ScanResult` and leave every warehouse decision to the parent.
 */
export function BarcodeScannerSheet(props: BarcodeScannerProps) {
  const {
    open,
    onDetected,
    onClose,
    onError,
    formats = WAREHOUSE_DEFAULT_FORMATS,
    continuous = false,
    dedupeWindowMs = 1500,
    enableWedge = true,
    allowManualEntry = true,
    title = 'Scan barcode',
    variant = 'sheet',
  } = props

  const deduper = useMemo(() => new ScanDeduper(dedupeWindowMs), [dedupeWindowMs])
  const [lastHit, setLastHit] = useState<ScanResult | null>(null)
  const [manualValue, setManualValue] = useState('')
  const [showManual, setShowManual] = useState(false)

  const emitError = useCallback((err: ScannerError) => onError?.(err), [onError])

  // Central accept path shared by camera, wedge, and manual entry.
  const accept = useCallback(
    (rawValue: string, format: ScanResult['format'], source: ScanResult['source']) => {
      const value = rawValue.trim()
      if (!value) return
      // Manual entry is a deliberate human action — bypass dedup.
      if (source !== 'manual' && !deduper.accept(value)) return

      const result: ScanResult = {
        rawValue: value,
        format,
        source,
        scannedAt: new Date().toISOString(),
      }
      signalHit()
      setLastHit(result)
      if (!continuous && source !== 'manual') scanner.pause()
      onDetected(result)
    },
    // scanner defined below; safe because accept is only *called* post-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [continuous, deduper, onDetected],
  )

  const scanner = useScanner({
    active: open && !showManual,
    formats,
    onDecode: (raw, fmt) => accept(raw, fmt, 'camera'),
    onError: emitError,
  })

  useKeyboardWedge((value) => accept(value, 'unknown', 'wedge'), open && enableWedge)

  // Reset transient UI each time the scanner opens.
  useEffect(() => {
    if (open) {
      setLastHit(null)
      setManualValue('')
      setShowManual(false)
      deduper.reset()
    }
  }, [open, deduper])

  const scanNext = useCallback(() => {
    setLastHit(null)
    deduper.reset()
    scanner.resume()
  }, [deduper, scanner])

  const submitManual = useCallback(() => {
    if (!manualValue.trim()) return
    accept(manualValue, 'unknown', 'manual')
    setManualValue('')
  }, [manualValue, accept])

  const rootRef = useRef<HTMLDivElement>(null)
  // Focus the sheet so Esc-to-close works. Split mode stays in-flow and must
  // NOT steal focus from the list the operator is working in.
  useEffect(() => {
    if (open && variant === 'sheet') rootRef.current?.focus()
  }, [open, variant])

  if (!open) return null

  const isSplit = variant === 'split'
  const errorCopy = scanner.error ? DEFAULT_ERROR_COPY[scanner.error.kind] : null

  const stage = (
    <div className="scanner-stage">
      {!showManual && (
        <>
          {/* muted + playsInline are required for iOS inline autoplay */}
          <video ref={scanner.videoRef} className="scanner-video" playsInline muted autoPlay />
          <ScanFrameOverlay scanning={scanner.status === 'scanning'} />

          {scanner.status === 'starting' && <div className="scanner-hint">Starting camera…</div>}
          {scanner.status === 'paused' && lastHit && (
            <div className="scanner-hint success">
              Captured: <code>{lastHit.rawValue}</code>
            </div>
          )}
          {scanner.status === 'error' && (
            <div className="scanner-error" role="alert">
              <p>{errorCopy}</p>
              {allowManualEntry && (
                <button className="btn" onClick={() => setShowManual(true)}>
                  Enter code manually
                </button>
              )}
            </div>
          )}
        </>
      )}

      {showManual && (
        <form
          className="manual-entry"
          onSubmit={(e) => {
            e.preventDefault()
            submitManual()
          }}
        >
          <label htmlFor="manual-code">Enter barcode</label>
          <input
            id="manual-code"
            inputMode="text"
            autoComplete="off"
            autoFocus
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
            placeholder="e.g. 0123456789012"
          />
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setShowManual(false)}>
              Back to camera
            </button>
            <button type="submit" className="btn primary" disabled={!manualValue.trim()}>
              Submit
            </button>
          </div>
        </form>
      )}
    </div>
  )

  const controls = !showManual && (
    <footer className={`scanner-controls ${isSplit ? 'compact' : ''}`}>
      {scanner.torchSupported && (
        <button
          className={`ctrl ${scanner.torchOn ? 'on' : ''}`}
          onClick={() => void scanner.toggleTorch()}
          aria-pressed={scanner.torchOn}
        >
          🔦 <span>Torch</span>
        </button>
      )}
      {scanner.canSwitchCamera && (
        <button className="ctrl" onClick={scanner.switchCamera}>
          🔄 <span>Flip</span>
        </button>
      )}
      {allowManualEntry && (
        <button className="ctrl" onClick={() => setShowManual(true)}>
          ⌨️ <span>Manual</span>
        </button>
      )}
      {isSplit && (
        <button className="ctrl" onClick={onClose}>
          ✕ <span>Done</span>
        </button>
      )}
      {!continuous && scanner.status === 'paused' && (
        <button className="ctrl primary wide" onClick={scanNext}>
          Scan next
        </button>
      )}
    </footer>
  )

  // --- split: in-flow pane; the parent keeps its list visible beneath -------
  if (isSplit) {
    return (
      <section className="scanner-pane" aria-label={title}>
        {stage}
        {controls}
      </section>
    )
  }

  // --- sheet: fullscreen modal --------------------------------------------
  return (
    <div
      className="scanner-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <header className="scanner-header">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close scanner">
          ✕
        </button>
      </header>
      {stage}
      {controls}
    </div>
  )
}
