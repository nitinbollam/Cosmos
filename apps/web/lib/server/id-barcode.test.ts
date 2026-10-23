import assert from 'node:assert/strict'
import test from 'node:test'
import { ageOn, checkIdBarcode, parseAamvaDate, readAamvaBarcode } from './id-barcode'

type Ymd = { year: number; month: number; day: number }
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const usDate = (d: Ymd) => `${pad(d.month)}${pad(d.day)}${d.year}`
const caDate = (d: Ymd) => `${d.year}${pad(d.month)}${pad(d.day)}`

/** AAMVA text the way a real card encodes it (fake data): header, subfile directory, elements. */
function licence(opts: { state: string; country?: 'USA' | 'CAN'; dob: Ymd; expiry: Ymd; issued?: Ymd; docType?: 'DL' | 'ID' }) {
  const country = opts.country ?? 'USA'
  const fmt = country === 'CAN' ? caDate : usDate
  const type = opts.docType ?? 'DL'
  const elements = [
    'DAQSAMPLE0001',
    'DCSSAMPLE',
    'DACTEST',
    `DBB${fmt(opts.dob)}`,
    `DBA${fmt(opts.expiry)}`,
    `DBD${fmt(opts.issued ?? { year: 2022, month: 1, day: 15 })}`,
    `DAJ${opts.state}`,
    `DCG${country}`,
  ]
  const subfile = `${type}${elements.join('\n')}\r`
  return `@\n\u001e\rANSI 6360151000${pad(1)}${type}${pad(31, 4)}${pad(subfile.length, 4)}${subfile}`
}

const NOW = new Date('2026-10-20T19:00:00Z') // 20 Oct 2026, afternoon in Dallas
const VALID = { year: 2029, month: 10, day: 20 }
const check = (text: string, minimumAge = 21) => checkIdBarcode(text, { minimumAge, now: NOW, timeZone: 'America/Chicago' })

test('an adult with a valid licence is verified', () => {
  const r = check(licence({ state: 'TX', dob: { year: 1992, month: 9, day: 10 }, expiry: VALID }))
  assert.equal(r.status, 'VERIFIED')
  assert.equal(r.record.issuingState, 'TX')
  assert.equal(r.record.ageRequirementMet, true)
})

test('the 21st birthday counts on the day itself; the day before does not', () => {
  assert.equal(check(licence({ state: 'CA', docType: 'ID', dob: { year: 2005, month: 10, day: 20 }, expiry: VALID })).status, 'VERIFIED')
  assert.equal(check(licence({ state: 'FL', dob: { year: 2005, month: 10, day: 21 }, expiry: VALID })).status, 'UNDER_AGE')
})

test('a lower minimum age is respected', () => {
  const nineteen = licence({ state: 'NY', dob: { year: 2007, month: 1, day: 5 }, expiry: VALID })
  assert.equal(check(nineteen, 21).status, 'UNDER_AGE')
  assert.equal(check(nineteen, 18).status, 'VERIFIED')
})

test('an expired ID is refused; the expiry date itself is still valid', () => {
  const dob = { year: 1980, month: 1, day: 1 }
  assert.equal(check(licence({ state: 'TX', dob, expiry: { year: 2026, month: 10, day: 19 } })).status, 'EXPIRED')
  assert.equal(check(licence({ state: 'TX', dob, expiry: { year: 2026, month: 10, day: 20 } })).status, 'VERIFIED')
})

test('Canadian cards write dates year-first', () => {
  assert.equal(check(licence({ state: 'ON', country: 'CAN', dob: { year: 1996, month: 3, day: 2 }, expiry: VALID })).status, 'VERIFIED')
  assert.deepEqual(parseAamvaDate('01151990', false), { year: 1990, month: 1, day: 15 })
  assert.deepEqual(parseAamvaDate('19900115', true), { year: 1990, month: 1, day: 15 })
  assert.equal(parseAamvaDate('02302000', false), null)
})

test('something that is not an ID is refused', () => {
  assert.equal(check('PLEROS-SHIPMENT|PO-10482|CARTON 3 OF 12').status, 'INVALID')
  assert.equal(check('').status, 'INVALID')
})

test('a scanner that drops the control characters still reads the card', () => {
  const text = licence({ state: 'TX', dob: { year: 1990, month: 1, day: 15 }, expiry: VALID }).replace(/[\u001e\r]/g, '').replace(/^@\n/, '')
  assert.equal(check(text).status, 'VERIFIED')
})

test('the birthday is judged in the company time zone, not the server clock', () => {
  // 03:00 UTC on 21 Oct is still 20 Oct in Dallas: someone born 21 Oct 2005 is not 21 there yet.
  const lateEvening = new Date('2026-10-21T03:00:00Z')
  const text = licence({ state: 'TX', dob: { year: 2005, month: 10, day: 21 }, expiry: VALID })
  assert.equal(checkIdBarcode(text, { minimumAge: 21, now: lateEvening, timeZone: 'America/Chicago' }).status, 'UNDER_AGE')
  assert.equal(checkIdBarcode(text, { minimumAge: 21, now: lateEvening, timeZone: 'Etc/UTC' }).status, 'VERIFIED')
})

test('names, licence number and date of birth are never read into the stored record', () => {
  const text = licence({ state: 'TX', dob: { year: 1990, month: 1, day: 15 }, expiry: VALID })
  const read = readAamvaBarcode(text)
  assert.equal(read.ok, true)
  assert.doesNotMatch(JSON.stringify(read), /SAMPLE|TEST/)
  const { record } = check(text)
  assert.deepEqual(Object.keys(record).sort(), [
    'ageRequirementMet', 'checkedAt', 'idExpiryOk', 'issuingState', 'method', 'minimumAge', 'result',
  ])
  assert.doesNotMatch(JSON.stringify(record), /1990/)
})

test('age is whole years', () => {
  assert.equal(ageOn({ year: 2005, month: 10, day: 20 }, { year: 2026, month: 10, day: 20 }), 21)
  assert.equal(ageOn({ year: 2005, month: 10, day: 21 }, { year: 2026, month: 10, day: 20 }), 20)
})
