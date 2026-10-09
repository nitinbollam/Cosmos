import { useCallback, useEffect, useRef, useState } from 'react'
import './photo-capture.css'

/** Logical drawing height. Width follows the container. */
const PAD_HEIGHT = 180
const STROKE_WIDTH = 2.5

export type CapturedSignature = {
  /** PNG data URL of the signature on a transparent background. */
  dataUrl: string
  bytes: number
}

type SignaturePadProps = {
  value: CapturedSignature | null
  onChange: (signature: CapturedSignature | null) => void
  label?: string
  disabled?: boolean
}

function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Math.round((base64.length * 3) / 4)
}

/**
 * Recipient signature capture, drawn on the driver's screen.
 *
 * Pointer events rather than touch or mouse events specifically: one code path
 * covers finger, stylus and (for desk testing) a mouse. `touch-action: none` on
 * the canvas stops the page scrolling out from under someone mid-signature,
 * which is the usual way these controls fail on a phone.
 *
 * Exported as PNG rather than JPEG — a signature is line art on a transparent
 * background, which PNG stores compactly and cleanly, where JPEG would add
 * visible artefacts around the strokes.
 */
export function SignaturePad({
  value,
  onChange,
  label = 'Recipient signature',
  disabled,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)
  const [dirty, setDirty] = useState(false)

  /** Size the backing store to the device pixel ratio so strokes aren't fuzzy. */
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth || 320
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(PAD_HEIGHT * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = STROKE_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Read the themed pen colour so the signature is legible in both themes.
    ctx.strokeStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--c-text').trim() || '#e4e4e7'
  }, [])

  useEffect(() => {
    fitCanvas()
    window.addEventListener('resize', fitCanvas)
    return () => window.removeEventListener('resize', fitCanvas)
  }, [fitCanvas])

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const { x, y } = pointFrom(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const { x, y } = pointFrom(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    hasInk.current = true
    if (!dirty) setDirty(true)
  }

  function onPointerUp() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    // Guard against a stray tap producing an "empty" signature.
    if (!canvas || !hasInk.current) return
    const dataUrl = canvas.toDataURL('image/png')
    onChange({ dataUrl, bytes: dataUrlBytes(dataUrl) })
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasInk.current = false
    setDirty(false)
    onChange(null)
  }

  return (
    <div className="pod-signature">
      <div className="pod-signature-head">
        <span className="pod-signature-label">{label}</span>
        {(dirty || value) && (
          <button type="button" className="btn-ghost pod-btn" onClick={clear} disabled={disabled}>
            Clear
          </button>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="pod-signature-canvas"
        style={{ height: PAD_HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        aria-label="Sign here"
        role="img"
      />
      {!dirty && !value && <p className="pod-signature-hint">Ask the recipient to sign above</p>}
    </div>
  )
}
