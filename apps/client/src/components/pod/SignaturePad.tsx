import { useCallback, useEffect, useRef, useState } from 'react'
import './photo-capture.css'

/** Logical drawing height. Width follows the container. */
const PAD_HEIGHT = 180
const STROKE_WIDTH = 2.5
/**
 * Fixed ink, deliberately not a theme token. The PNG outlives the screen it was
 * drawn on: a pen taken from the dark theme's text colour is near-white, and
 * vanishes on the light plate staff view it on. The pad itself is the same light
 * plate in every theme (photo-capture.css), so what the recipient sees while
 * signing is what gets stored.
 */
const INK = '#1f2328'

type Point = { x: number; y: number }

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
 * Strokes are kept as points as well as pixels. Resizing a canvas wipes it, and a
 * phone rotating or a desktop window resizing mid-signature would otherwise
 * leave a blank pad that still counts as signed.
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
  const strokes = useRef<Point[][]>([])
  const fittedWidth = useRef(0)
  const [dirty, setDirty] = useState(false)

  const contextFor = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.lineWidth = STROKE_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INK
    return ctx
  }

  const redraw = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = contextFor(canvas)
    if (!ctx) return
    for (const stroke of strokes.current) {
      if (stroke.length < 2) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0].x, stroke[0].y)
      for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }, [])

  /**
   * Size the backing store to the device pixel ratio so strokes aren't fuzzy, and
   * bring existing strokes across. Height-only changes (a mobile address bar
   * collapsing) are ignored: the pad's height is fixed, so nothing needs redoing.
   */
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const measured = canvas.clientWidth
    // A hidden pad (e.g. while the stop's "mark failed" form is open) measures 0:
    // leave the strokes as they are until it's shown again.
    if (measured === 0 && fittedWidth.current > 0) return
    const width = measured || 320
    if (width === fittedWidth.current) return

    // Shrink strokes to fit a narrower pad; never stretch them on a wider one.
    const previous = fittedWidth.current
    const scale = previous > 0 ? Math.min(1, width / previous) : 1
    if (scale !== 1) {
      strokes.current = strokes.current.map((stroke) => stroke.map((p) => ({ x: p.x * scale, y: p.y * scale })))
    }
    fittedWidth.current = width

    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(PAD_HEIGHT * ratio)
    canvas.getContext('2d')?.scale(ratio, ratio)
    redraw(canvas)
  }, [redraw])

  useEffect(() => {
    fitCanvas()
    const canvas = canvasRef.current
    if (canvas && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => fitCanvas())
      observer.observe(canvas)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', fitCanvas)
    return () => window.removeEventListener('resize', fitCanvas)
  }, [fitCanvas])

  const clearPad = useCallback(() => {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    strokes.current = []
    drawing.current = false
    setDirty(false)
  }, [])

  // The parent resets `value` to null after a delivery is recorded. Wipe the pad
  // with it: strokes left on screen over an empty value look signed and aren't.
  useEffect(() => {
    if (value === null && strokes.current.length > 0) clearPad()
  }, [value, clearPad])

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    strokes.current.push([pointFrom(e)])
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas && contextFor(canvas)
    const stroke = strokes.current[strokes.current.length - 1]
    if (!ctx || !stroke) return
    const from = stroke[stroke.length - 1]
    const to = pointFrom(e)
    stroke.push(to)
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    if (!dirty) setDirty(true)
  }

  function onPointerUp() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    // Guard against a stray tap producing an "empty" signature.
    if (!canvas || !strokes.current.some((s) => s.length > 1)) return
    const dataUrl = canvas.toDataURL('image/png')
    onChange({ dataUrl, bytes: dataUrlBytes(dataUrl) })
  }

  function clear() {
    clearPad()
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
