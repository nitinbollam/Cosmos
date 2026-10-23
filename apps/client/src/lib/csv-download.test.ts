import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCsv, csvEscape } from './csv-download'

test('cells that a spreadsheet would run as a formula open as text', () => {
  assert.equal(csvEscape('=1+1'), "'=1+1")
  assert.equal(csvEscape('+1+1'), "'+1+1")
  assert.equal(csvEscape('+1-555-1424'), "'+1-555-1424")
  assert.equal(csvEscape('-2+3'), "'-2+3")
  assert.equal(csvEscape('@SUM(A1:A2)'), "'@SUM(A1:A2)")
  assert.equal(csvEscape('\t=cmd'), "'\t=cmd")
  // Still quoted when it also holds a comma or a quote.
  assert.equal(csvEscape('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`)
})

test('plain numbers and ordinary text are unchanged', () => {
  assert.equal(csvEscape('-12.50'), '-12.50')
  assert.equal(csvEscape('+42'), '+42')
  assert.equal(csvEscape(-7), '-7')
  assert.equal(csvEscape('Acme, Inc.'), '"Acme, Inc."')
  assert.equal(csvEscape('a-b'), 'a-b')
  assert.equal(csvEscape(null), '')
})

test('headers are escaped too', () => {
  assert.equal(buildCsv(['=evil'], [['ok']]), "'=evil\nok")
})
