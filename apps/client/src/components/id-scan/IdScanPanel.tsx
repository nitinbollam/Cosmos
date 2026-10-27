import { lazy, Suspense, useState } from 'react'
import type { ScanResult } from '@/components/scanner/types'

// Lazy so the decode engine is only fetched when someone actually scans an ID.
const BarcodeScannerSheet = lazy(() =>
  import('@/components/scanner/BarcodeScannerSheet').then((m) => ({ default: m.BarcodeScannerSheet })),
)

export type IdScanStatus = 'VERIFIED' | 'UNDER_AGE' | 'EXPIRED' | 'INVALID'

/** The server's answer for a scanned ID (POST /compliance/id-scan). No personal details. */
export type IdScanResult = {
  status: IdScanStatus
  message: string
  minimumAge: number
}

/** A scanned ID: the raw barcode (sent with the delivery or sale, never stored) and the server's answer. */
export type IdScan = { barcode: string; result: IdScanResult }

const STATUS: Record<IdScanStatus, { color: string; icon: string; title: string }> = {
  VERIFIED: { color: 'var(--c-success)', icon: '✓', title: 'ID verified' },
  UNDER_AGE: { color: 'var(--c-danger)', icon: '✗', title: 'Under age' },
  EXPIRED: { color: 'var(--c-danger)', icon: '✗', title: 'ID expired' },
  INVALID: { color: 'var(--c-warning)', icon: '!', title: 'Not a valid ID' },
}

/** Short failure label, e.g. for a delivery's failed reason. */
export function idScanFailureTitle(scan: IdScan | null): string | null {
  return scan && scan.result.status !== 'VERIFIED' ? STATUS[scan.result.status].title : null
}

/**
 * PLR-35: age check by scanning the PDF417 barcode on the back of a US / Canadian driver's
 * licence or state ID. The server decides; there is no manual option. Used by the driver app
 * and the POS, which pass their own API call in `checkId`.
 */
export function IdScanPanel(props: {
  minimumAge: number
  value: IdScan | null
  onChange: (scan: IdScan | null) => void
  checkId: (barcode: string, minimumAge: number) => Promise<IdScanResult>
  /** Shown above the buttons, e.g. "Scan the recipient's ID". */
  prompt?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function check(barcode: string) {
    setBusy(true)
    setError(null)
    try {
      props.onChange({ barcode, result: await props.checkId(barcode, props.minimumAge) })
    } catch (e) {
      props.onChange(null)
      const message = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message
      setError(typeof message === 'string' ? message : "Couldn't check the ID. Check the connection and scan again.")
    } finally {
      setBusy(false)
    }
  }

  async function fromPhoto(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    const url = URL.createObjectURL(file)
    try {
      const { BrowserPDF417Reader } = await import('@zxing/browser')
      const decoded = await new BrowserPDF417Reader().decodeFromImageUrl(url)
      await check(decoded.getText())
    } catch {
      props.onChange(null)
      setError('No ID barcode found in that photo. Fill the frame with the barcode on the back, in focus, without glare.')
      setBusy(false)
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const scan = props.value
  const style = scan ? STATUS[scan.result.status] : null

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ margin: '0 0 6px', fontSize: 13 }}>
        {props.prompt ?? 'Scan the barcode on the back of their driver’s licence or state ID.'} {props.minimumAge}+ required.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => setOpen(true)}>
          {busy ? 'Checking…' : scan ? 'Scan again' : 'Scan ID'}
        </button>
        <label className="btn-ghost" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', cursor: busy ? 'default' : 'pointer' }}>
          Use a photo of the back
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={busy}
            onChange={(e) => {
              void fromPhoto(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {error && (
        <p role="alert" style={{ marginTop: 8, fontSize: 13, color: 'var(--c-danger)' }}>
          {error}
        </p>
      )}
      {scan && style && (
        <div
          role="status"
          style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, border: `2px solid ${style.color}`, background: 'var(--c-surface)' }}
        >
          <strong style={{ color: style.color }}>
            {style.icon} {scan.result.status === 'VERIFIED' ? scan.result.message : style.title}
          </strong>
          {scan.result.status !== 'VERIFIED' && <div style={{ fontSize: 13, marginTop: 2 }}>{scan.result.message}</div>}
        </div>
      )}

      {open && (
        <Suspense fallback={null}>
          <BarcodeScannerSheet
            open
            title="Scan the barcode on the back of the ID"
            formats={['pdf417']}
            allowManualEntry={false}
            enableWedge={false}
            hint="Hold the back of the card flat, 15–25 cm away, barcode filling the width. Avoid glare."
            showCameraInfo
            onClose={() => setOpen(false)}
            onDetected={(hit: ScanResult) => {
              setOpen(false)
              void check(hit.rawValue)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
