/**
 * GTIN normalization.
 *
 * The same physical barcode legitimately decodes to different strings depending
 * on the engine and device:
 *   - native BarcodeDetector (Android/macOS) -> "096619926626"  (upc_a, 12)
 *   - ZXing                                  -> "0096619926626" (ean_13, 13)
 * because a UPC-A *is* an EAN-13 with a leading zero. Comparing raw strings
 * makes a product resolve on one device and land in exceptions on another.
 *
 * GS1's own answer is to right-align every GTIN into a 14-digit field, so
 * GTIN-8/12/13/14 forms of one product compare equal. Do this in *lookup*, never
 * by mutating `ScanResult.rawValue` — the raw read stays audit-accurate.
 */

/**
 * Right-align a numeric barcode into GTIN-14. Non-numeric payloads (QR, Code 39
 * / Code 128 with letters, license plates) are returned untouched — they aren't
 * GTINs and must not be zero-padded.
 */
export function normalizeGtin(value: string): string {
  const v = value.trim()
  if (!/^\d+$/.test(v)) return v
  if (v.length > 14) return v // not a GTIN; leave alone
  return v.padStart(14, '0')
}

/** True when two barcode strings denote the same GTIN (or are identical). */
export function gtinEquals(a: string, b: string): boolean {
  return normalizeGtin(a) === normalizeGtin(b)
}

/**
 * NOTE — UPC-E: the compressed 8-digit form is NOT a zero-padded UPC-A; turning
 * it into one requires the GS1 expansion algorithm. Engines usually report UPC-E
 * already expanded, but if you stock items labelled UPC-E, verify what your
 * devices actually emit and store the emitted form in the catalog.
 *
 * NOTE — collisions: a short *numeric* Code 128 internal SKU (e.g. "12345")
 * normalizes into the same 14-digit space as a real GTIN. If Pleros mixes
 * internal numeric codes with GTINs, compare `format` too, or namespace them.
 */
