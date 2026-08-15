import { ScannerError, type ScannerErrorKind } from './types'

/**
 * Map a raw getUserMedia failure to a typed ScannerError. The DOMException
 * `name` is the reliable signal across browsers — far more so than the message.
 * This is what lets the UI say "close the other app" vs "enable in Settings".
 */
export function mapGetUserMediaError(err: unknown): ScannerError {
  const name =
    err instanceof DOMException || (err instanceof Error && 'name' in err)
      ? (err as Error).name
      : ''

  const kind: ScannerErrorKind = ((): ScannerErrorKind => {
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'permission-denied'
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'no-camera'
      case 'NotReadableError':
      case 'TrackStartError':
        return 'camera-busy'
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return 'overconstrained'
      default:
        return 'unknown'
    }
  })()

  return new ScannerError(kind, `getUserMedia failed: ${name || 'unknown'}`, err)
}

/**
 * Preflight: is camera capture even possible here? Returns a ScannerError to
 * short-circuit with, or null if we're clear to request the stream.
 */
export function preflightCameraSupport(): ScannerError | null {
  if (typeof window === 'undefined') {
    return new ScannerError('unsupported', 'No window/DOM available.')
  }
  // Secure-context is the #1 silent failure in field testing (bare LAN IPs).
  if (window.isSecureContext === false) {
    return new ScannerError(
      'insecure-context',
      'Camera requires a secure context (HTTPS or localhost).',
    )
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return new ScannerError('unsupported', 'getUserMedia is not available.')
  }
  return null
}
