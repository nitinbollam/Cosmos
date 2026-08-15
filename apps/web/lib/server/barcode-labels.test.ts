import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildLabelDocumentHtml,
  clampLabelQuantity,
  renderCode128Svg,
  renderQrSvg,
  resolveLabelSize,
  resolveLabelSymbols,
  scanValueForSku,
} from './barcode-labels'
import { getGtinLookupCandidates } from './inventory'

test('resolveLabelSize falls back to 4x2', () => {
  assert.equal(resolveLabelSize('4x1'), '4x1')
  assert.equal(resolveLabelSize('2x1'), '2x1')
  assert.equal(resolveLabelSize('nope'), '4x2')
  assert.equal(resolveLabelSize(undefined), '4x2')
})

test('resolveLabelSymbols accepts aliases', () => {
  assert.equal(resolveLabelSymbols('both'), 'both')
  assert.equal(resolveLabelSymbols('code128'), 'code128')
  assert.equal(resolveLabelSymbols('barcode'), 'code128')
  assert.equal(resolveLabelSymbols('qr'), 'qr')
  assert.equal(resolveLabelSymbols('qrcode'), 'qr')
  assert.equal(resolveLabelSymbols('mystery'), 'both')
})

test('clampLabelQuantity bounds 1–99', () => {
  assert.equal(clampLabelQuantity(1), 1)
  assert.equal(clampLabelQuantity(0), 1)
  assert.equal(clampLabelQuantity(200), 99)
  assert.equal(clampLabelQuantity(Number.NaN), 1)
})

test('scanValueForSku prefers barcode over code', () => {
  assert.equal(scanValueForSku({ name: 'A', code: 'SKU-1', barcode: '  012345  ' }), '012345')
  assert.equal(scanValueForSku({ name: 'A', code: 'SKU-1', barcode: null }), 'SKU-1')
  assert.equal(scanValueForSku({ name: 'A', code: 'SKU-1', barcode: '' }), 'SKU-1')
})

test('renderCode128Svg emits scannable SVG path', () => {
  const svg = renderCode128Svg('SKU-ABC-001')
  assert.match(svg, /^<svg\b/)
  assert.match(svg, /viewBox=/)
  assert.match(svg, /<path\b/)
  assert.doesNotMatch(svg, /<\?xml/)
})

test('renderQrSvg emits QR SVG', () => {
  const svg = renderQrSvg('SKU-ABC-001')
  assert.match(svg, /^<svg\b/)
  assert.match(svg, /viewBox=/)
  assert.match(svg, /<path\b/)
})

test('buildLabelDocumentHtml includes Code128 + QR and batch copies', () => {
  const html = buildLabelDocumentHtml(
    { name: 'Widget <X>', code: 'W-1', barcode: 'BC-99' },
    { quantity: 3, size: '4x2', symbols: 'both' },
  )
  assert.match(html, /@page/)
  assert.match(html, /size:\s*4in 2in/)
  assert.equal((html.match(/class="label/g) ?? []).length, 3)
  assert.match(html, /class="code128"/)
  assert.match(html, /class="qr"/)
  assert.match(html, /Widget &lt;X&gt;/)
  assert.match(html, /BC-99/)
  assert.doesNotMatch(html, /\*[^*]+\*/)
})

test('buildLabelDocumentHtml supports QR-only compact size', () => {
  const html = buildLabelDocumentHtml(
    { name: 'Tiny', code: 'T-1' },
    { quantity: 1, size: '2x1', symbols: 'qr' },
  )
  assert.match(html, /size:\s*2in 1in/)
  assert.match(html, /class="qr"/)
  assert.doesNotMatch(html, /class="code128"/)
  assert.match(html, /layout-compact/)
})

test('getGtinLookupCandidates expands numeric barcodes into UPC-A, EAN-13, and GTIN-14 permutations', () => {
  const upcACandidates = getGtinLookupCandidates('096619926626')
  assert.ok(upcACandidates.includes('096619926626'))
  assert.ok(upcACandidates.includes('96619926626'))
  assert.ok(upcACandidates.includes('00096619926626'))
  assert.ok(upcACandidates.includes('0096619926626'))

  const eanCandidates = getGtinLookupCandidates('0096619926626')
  assert.ok(eanCandidates.includes('0096619926626'))
  assert.ok(eanCandidates.includes('096619926626'))
  assert.ok(eanCandidates.includes('96619926626'))
  assert.ok(eanCandidates.includes('00096619926626'))

  const nonNumeric = getGtinLookupCandidates('BIN-A1')
  assert.deepEqual(nonNumeric, ['BIN-A1'])
})

