import type { ScanEngine, RawDetection } from './types'
import type { BarcodeFormat } from '../types'
import { fromNativeFormat, toNativeFormats } from './formats'

/**
 * Native `BarcodeDetector` engine — the fast path (hardware-accelerated on
 * Android Chrome). Deliberately treated as an *optimization*, not the primary:
 * it is absent on iOS Safari and desktop Firefox, so `pickEngine` only selects
 * it after confirming it can actually construct + report supported formats.
 */
export class NativeEngine implements ScanEngine {
  readonly name = 'BarcodeDetector'
  private detector: BarcodeDetector

  private constructor(detector: BarcodeDetector) {
    this.detector = detector
  }

  /** Returns an engine only if the API exists and supports usable formats. */
  static async tryCreate(formats: BarcodeFormat[]): Promise<NativeEngine | null> {
    if (typeof window === 'undefined' || !window.BarcodeDetector) return null
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats()
      if (!supported || supported.length === 0) return null
      const requested = toNativeFormats(formats).filter((f) => supported.includes(f))
      // If the caller asked for specific formats and none are supported here,
      // fall back to ZXing rather than silently scanning the wrong set.
      if (formats.length > 0 && requested.length === 0) return null
      const detector = new window.BarcodeDetector(
        requested.length > 0 ? { formats: requested } : undefined,
      )
      return new NativeEngine(detector)
    } catch {
      return null
    }
  }

  async decode(canvas: HTMLCanvasElement): Promise<RawDetection | null> {
    const results = await this.detector.detect(canvas)
    const hit = results[0]
    if (!hit || !hit.rawValue) return null
    return { rawValue: hit.rawValue, format: fromNativeFormat(hit.format) }
  }

  dispose(): void {
    // Native detector holds no resources we own.
  }
}
