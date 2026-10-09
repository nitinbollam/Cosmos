import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ScanDeduper } from './dedupe'
import { WedgeParser } from './wedge'
import { normalizeGtin, gtinEquals } from './gtin'
import {
  fromNativeFormat,
  toNativeFormats,
  fromZXingFormat,
  toZXingFormats,
  WAREHOUSE_DEFAULT_FORMATS,
} from './engines/formats'
import { BarcodeFormat as ZXingFormat } from '@zxing/library'
import { mapGetUserMediaError, preflightCameraSupport } from './errors'
import { ScannerError } from './types'

describe('ScanDeduper', () => {
  it('accepts initial scan and dedupes rapid repeats within window', () => {
    let now = 1000
    const deduper = new ScanDeduper(1500, () => now)

    // First scan accepted
    assert.equal(deduper.accept('SKU-123'), true)

    // Rapid duplicate within 1500ms rejected
    now = 1500
    assert.equal(deduper.accept('SKU-123'), false)

    // Different barcode accepted even within window
    assert.equal(deduper.accept('SKU-456'), true)

    // Original barcode accepted after window elapsed
    now = 3100
    assert.equal(deduper.accept('SKU-123'), true)
  })

  it('reset() clears dedup history immediately', () => {
    let now = 1000
    const deduper = new ScanDeduper(1500, () => now)

    assert.equal(deduper.accept('SKU-999'), true)
    assert.equal(deduper.accept('SKU-999'), false)

    deduper.reset()
    assert.equal(deduper.accept('SKU-999'), true)
  })
})

describe('WedgeParser', () => {
  it('parses rapid hardware keystrokes ending in Enter', () => {
    let clock = 1000
    const parser = new WedgeParser({ maxIntervalMs: 50, minLength: 3 }, () => clock)

    // Fast burst: 10ms between keystrokes
    assert.equal(parser.handle('0'), null)
    clock += 10
    assert.equal(parser.handle('9'), null)
    clock += 10
    assert.equal(parser.handle('6'), null)
    clock += 10
    assert.equal(parser.handle('6'), null)
    clock += 10
    const result = parser.handle('Enter')
    assert.equal(result, '0966')
  })

  it('rejects slow human typing', () => {
    let clock = 1000
    const parser = new WedgeParser({ maxIntervalMs: 50, minLength: 3 }, () => clock)

    // Typing 'a'
    parser.handle('a')
    // Wait 200ms (> 50ms)
    clock += 200
    parser.handle('b')
    clock += 200
    parser.handle('c')
    clock += 10
    // At Enter, only 'c' is in the buffer since slow gap purged earlier characters
    const result = parser.handle('Enter')
    assert.equal(result, null)
  })

  it('rejects bursts shorter than minLength', () => {
    let clock = 1000
    const parser = new WedgeParser({ maxIntervalMs: 50, minLength: 4 }, () => clock)

    parser.handle('1')
    clock += 5
    parser.handle('2')
    clock += 5
    assert.equal(parser.handle('Enter'), null)
  })

  it('ignores non-printable/modifier keys', () => {
    let clock = 1000
    const parser = new WedgeParser({ maxIntervalMs: 50, minLength: 3 }, () => clock)

    parser.handle('Shift')
    clock += 5
    parser.handle('A')
    clock += 5
    parser.handle('Alt')
    clock += 5
    parser.handle('B')
    clock += 5
    parser.handle('C')
    clock += 5
    assert.equal(parser.handle('Enter'), 'ABC')
  })
})

describe('GTIN utilities', () => {
  it('normalizes numeric barcodes into 14-digit GTIN space', () => {
    assert.equal(normalizeGtin('096619926626'), '00096619926626') // UPC-A (12)
    assert.equal(normalizeGtin('0096619926626'), '00096619926626') // EAN-13 (13)
    assert.equal(normalizeGtin('00096619926626'), '00096619926626') // GTIN-14
    assert.equal(normalizeGtin('12345670'), '00000012345670') // EAN-8
  })

  it('preserves non-numeric and alphanumeric values without padding', () => {
    assert.equal(normalizeGtin('BIN-A-01'), 'BIN-A-01')
    assert.equal(normalizeGtin('PALLET_4848'), 'PALLET_4848')
    assert.equal(normalizeGtin('1234567890123456'), '1234567890123456') // >14 digits
  })

  it('gtinEquals correctly matches UPC-A and EAN-13 representations', () => {
    assert.equal(gtinEquals('096619926626', '0096619926626'), true)
    assert.equal(gtinEquals('096619926626', '096619926626'), true)
    assert.equal(gtinEquals('BIN-01', 'BIN-01'), true)
    assert.equal(gtinEquals('BIN-01', 'BIN-02'), false)
  })
})

describe('Engine formats', () => {
  it('converts native format strings with casing and delimiter tolerance', () => {
    assert.equal(fromNativeFormat('qr_code'), 'qr_code')
    assert.equal(fromNativeFormat('QR-CODE'), 'qr_code')
    assert.equal(fromNativeFormat('code_128'), 'code_128')
    assert.equal(fromNativeFormat('CODE-128'), 'code_128')
    assert.equal(fromNativeFormat('unknown_format'), 'unknown')
  })

  it('converts to native format string array', () => {
    const list = toNativeFormats(['code_128', 'qr_code', 'ean_13'])
    assert.deepEqual(list, ['code_128', 'qr_code', 'ean_13'])
  })

  it('converts ZXing formats bidirectional', () => {
    assert.equal(fromZXingFormat(ZXingFormat.CODE_128), 'code_128')
    assert.equal(fromZXingFormat(ZXingFormat.QR_CODE), 'qr_code')

    const zxingList = toZXingFormats(['code_128', 'qr_code'])
    assert.deepEqual(zxingList, [ZXingFormat.CODE_128, ZXingFormat.QR_CODE])
  })

  it('warehouse default formats contains essential symbologies', () => {
    assert.ok(WAREHOUSE_DEFAULT_FORMATS.includes('code_128'))
    assert.ok(WAREHOUSE_DEFAULT_FORMATS.includes('ean_13'))
    assert.ok(WAREHOUSE_DEFAULT_FORMATS.includes('upc_a'))
    assert.ok(WAREHOUSE_DEFAULT_FORMATS.includes('qr_code'))
  })
})

describe('Scanner error mapping', () => {
  it('maps DOMException errors to typed ScannerError kinds', () => {
    const permErr = mapGetUserMediaError(new DOMException('Permission denied', 'NotAllowedError'))
    assert.equal(permErr.kind, 'permission-denied')

    const busyErr = mapGetUserMediaError(new DOMException('Camera busy', 'NotReadableError'))
    assert.equal(busyErr.kind, 'camera-busy')

    const noCamErr = mapGetUserMediaError(new DOMException('No camera', 'NotFoundError'))
    assert.equal(noCamErr.kind, 'no-camera')

    const overErr = mapGetUserMediaError(new DOMException('Overconstrained', 'OverconstrainedError'))
    assert.equal(overErr.kind, 'overconstrained')
  })

  it('preflightCameraSupport handles environment checks', () => {
    // In node test environment, window or getUserMedia may be missing
    const res = preflightCameraSupport()
    assert.ok(res instanceof ScannerError)
  })
})
