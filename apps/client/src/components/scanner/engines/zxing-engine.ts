import { BrowserMultiFormatReader } from '@zxing/browser'
import { DecodeHintType, NotFoundException } from '@zxing/library'
import type { ScanEngine, RawDetection } from './types'
import type { BarcodeFormat } from '../types'
import { fromZXingFormat, toZXingFormats } from './formats'

/**
 * ZXing engine — the portable primary. Pure JS, works everywhere getUserMedia
 * does (including iOS Safari). We drive it frame-by-frame from our own canvas
 * (`decodeFromCanvas`) rather than letting ZXing own the camera stream, so the
 * scanner keeps full control of torch, camera selection, and error typing.
 */
export class ZXingEngine implements ScanEngine {
  readonly name = 'ZXing'
  private reader: BrowserMultiFormatReader

  constructor(formats: BarcodeFormat[]) {
    const hints = new Map<DecodeHintType, unknown>()
    const zFormats = toZXingFormats(formats)
    if (zFormats.length > 0) {
      hints.set(DecodeHintType.POSSIBLE_FORMATS, zFormats)
    }
    // TRY_HARDER trades a little CPU for materially better reads on worn /
    // low-contrast 1D labels — the realistic warehouse condition.
    hints.set(DecodeHintType.TRY_HARDER, true)
    this.reader = new BrowserMultiFormatReader(hints)
  }

  async decode(canvas: HTMLCanvasElement): Promise<RawDetection | null> {
    try {
      const result = this.reader.decodeFromCanvas(canvas)
      const raw = result.getText()
      if (!raw) return null
      return { rawValue: raw, format: fromZXingFormat(result.getBarcodeFormat()) }
    } catch (err) {
      // "Not found" is the normal per-frame outcome, not an error.
      if (err instanceof NotFoundException) return null
      if (err instanceof Error && /not\s*found/i.test(err.message)) return null
      throw err
    }
  }

  dispose(): void {
    // BrowserMultiFormatReader has no long-lived stream here (we never called
    // decodeFromVideoDevice), but reset() is safe and future-proofs teardown.
    try {
      ;(this.reader as unknown as { reset?: () => void }).reset?.()
    } catch {
      /* noop */
    }
  }
}
