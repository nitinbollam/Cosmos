/**
 * Public entry point for the Pleros scanner. Import from here in warehouse
 * screens; everything else is an implementation detail.
 *
 *   import { BarcodeScannerSheet, type ScanResult } from "@pleros/barcode-scanner";
 */
export { BarcodeScannerSheet } from './BarcodeScannerSheet'
export { ScanFrameOverlay } from './ScanFrameOverlay'
export { useScanner } from './useScanner'
export { useKeyboardWedge } from './useKeyboardWedge'
export { ScanDeduper } from './dedupe'
export { normalizeGtin, gtinEquals } from './gtin'
export { WedgeParser } from './wedge'
export { WAREHOUSE_DEFAULT_FORMATS, pickEngine } from './engines'
export {
  ScannerError,
  DEFAULT_ERROR_COPY,
  type BarcodeScannerProps,
  type BarcodeFormat,
  type ScanResult,
  type ScanSource,
  type ScannerStatus,
  type ScannerErrorKind,
} from './types'
