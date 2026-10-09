import { BarcodeFormat as ZXingFormat } from '@zxing/library'
import type { BarcodeFormat } from '../types'

/**
 * Format normalization. Both engines speak different dialects; the rest of the
 * app should only ever see our `BarcodeFormat` union. Keeping the maps here
 * (rather than scattered in each engine) makes "which symbologies do we
 * actually support" answerable in one place.
 */

// --- native BarcodeDetector strings -> our union ---------------------------
const NATIVE_TO_FORMAT: Record<string, BarcodeFormat> = {
  qr_code: 'qr_code',
  code_128: 'code_128',
  code_39: 'code_39',
  code_93: 'code_93',
  codabar: 'codabar',
  ean_13: 'ean_13',
  ean_8: 'ean_8',
  upc_a: 'upc_a',
  upc_e: 'upc_e',
  itf: 'itf',
  data_matrix: 'data_matrix',
  pdf417: 'pdf417',
  aztec: 'aztec',
}

export function fromNativeFormat(native: string): BarcodeFormat {
  if (!native) return 'unknown'
  const norm = native.toLowerCase().replace(/-/g, '_')
  return NATIVE_TO_FORMAT[norm] ?? 'unknown'
}

export function toNativeFormats(formats: BarcodeFormat[]): string[] {
  const inverse = Object.entries(NATIVE_TO_FORMAT)
  return formats
    .map((f) => inverse.find(([, v]) => v === f)?.[0])
    .filter((s): s is string => Boolean(s))
}

// --- ZXing enum -> our union ------------------------------------------------
const ZXING_TO_FORMAT: Partial<Record<ZXingFormat, BarcodeFormat>> = {
  [ZXingFormat.QR_CODE]: 'qr_code',
  [ZXingFormat.CODE_128]: 'code_128',
  [ZXingFormat.CODE_39]: 'code_39',
  [ZXingFormat.CODE_93]: 'code_93',
  [ZXingFormat.CODABAR]: 'codabar',
  [ZXingFormat.EAN_13]: 'ean_13',
  [ZXingFormat.EAN_8]: 'ean_8',
  [ZXingFormat.UPC_A]: 'upc_a',
  [ZXingFormat.UPC_E]: 'upc_e',
  [ZXingFormat.ITF]: 'itf',
  [ZXingFormat.DATA_MATRIX]: 'data_matrix',
  [ZXingFormat.PDF_417]: 'pdf417',
  [ZXingFormat.AZTEC]: 'aztec',
}

export function fromZXingFormat(format: ZXingFormat): BarcodeFormat {
  return ZXING_TO_FORMAT[format] ?? 'unknown'
}

const FORMAT_TO_ZXING: Record<BarcodeFormat, ZXingFormat | undefined> = {
  qr_code: ZXingFormat.QR_CODE,
  code_128: ZXingFormat.CODE_128,
  code_39: ZXingFormat.CODE_39,
  code_93: ZXingFormat.CODE_93,
  codabar: ZXingFormat.CODABAR,
  ean_13: ZXingFormat.EAN_13,
  ean_8: ZXingFormat.EAN_8,
  upc_a: ZXingFormat.UPC_A,
  upc_e: ZXingFormat.UPC_E,
  itf: ZXingFormat.ITF,
  data_matrix: ZXingFormat.DATA_MATRIX,
  pdf417: ZXingFormat.PDF_417,
  aztec: ZXingFormat.AZTEC,
  unknown: undefined,
}

export function toZXingFormats(formats: BarcodeFormat[]): ZXingFormat[] {
  return formats.map((f) => FORMAT_TO_ZXING[f]).filter((z): z is ZXingFormat => z !== undefined)
}

/** The symbologies that matter most in wholesale-distribution warehouses. */
export const WAREHOUSE_DEFAULT_FORMATS: BarcodeFormat[] = [
  'code_128', // cartons, shipping labels, internal SKUs
  'ean_13', // retail unit packs
  'upc_a', // retail unit packs (NA)
  'itf', // ITF-14 case/inner packs
  'code_39', // legacy asset/location labels
  'qr_code', // bins, license plates, 2D routing
  'data_matrix', // small-part marking
]
