import { useRef, useState } from 'react'
import './photo-capture.css'

/**
 * Longest edge of the stored image, in pixels. 1280 keeps a parcel label or a
 * doorstep legible enough to settle a dispute while holding a typical photo
 * near 100-150 kB once encoded.
 */
const MAX_EDGE = 1280
const JPEG_QUALITY = 0.7

export type CapturedPhoto = {
  /** JPEG data URL, already downscaled. */
  dataUrl: string
  /** Approximate stored size in bytes, for display and guard rails. */
  bytes: number
}

type PhotoCaptureProps = {
  value: CapturedPhoto | null
  onChange: (photo: CapturedPhoto | null) => void
  label?: string
  disabled?: boolean
}

/** Rough byte count of a data URL's payload, without allocating a Blob. */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Math.round((base64.length * 3) / 4)
}

/**
 * Downscale to MAX_EDGE and re-encode as JPEG.
 *
 * This is not cosmetic. A modern phone camera produces 3-5 MB per shot, and the
 * photo is stored inline in the stop's POD record — sending the original would
 * bloat every row and every database backup. Resizing on the device also means
 * the driver uploads ~100 kB over a patchy mobile connection instead of megabytes.
 */
async function downscale(file: File): Promise<CapturedPhoto> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the photo on this device')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  return { dataUrl, bytes: dataUrlBytes(dataUrl) }
}

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)} kB`
}

/**
 * Capture a proof-of-delivery photo on the driver's phone.
 *
 * Uses a file input with `capture="environment"` rather than getUserMedia: the
 * native camera gives autofocus, flash and a UI drivers already know, and it
 * returns a full-resolution still. Our scanner's video pipeline is tuned for
 * continuous low-res decoding, which is the wrong tool for evidence photos.
 *
 * On a desktop browser the same input falls back to a file picker, which keeps
 * the dispatch screens testable without a phone.
 */
export function PhotoCapture({ value, onChange, label = 'Add delivery photo', disabled }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      onChange(await downscale(file))
    } catch {
      setError('Could not read that photo. Try again.')
    } finally {
      setBusy(false)
      // Clear the input so re-picking the same file still fires a change event.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="pod-capture">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {value ? (
        <div className="pod-preview">
          <img src={value.dataUrl} alt="Proof of delivery" />
          <div className="pod-preview-actions">
            <span className="pod-size">{formatKb(value.bytes)}</span>
            <button
              type="button"
              className="btn-ghost pod-btn"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || busy}
            >
              Retake
            </button>
            <button
              type="button"
              className="btn-ghost pod-btn"
              onClick={() => onChange(null)}
              disabled={disabled || busy}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="pod-capture-btn"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
        >
          <span aria-hidden="true">📷</span> {busy ? 'Processing…' : label}
        </button>
      )}

      {error && <p className="pod-error">{error}</p>}
    </div>
  )
}
