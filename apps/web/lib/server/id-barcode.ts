/**
 * PLR-35 — age check from the PDF417 barcode on the back of a US / Canadian driver's licence
 * or state ID (AAMVA standard). The server makes the decision; screens only send the barcode.
 *
 * Only the fields needed for an age decision are read: date of birth, expiry, issue date,
 * issuing state/province and country. Names, address and licence number are never extracted,
 * and only `record` (no date of birth, no name, no licence number) is ever stored.
 *
 * Pure functions: no DB, no session, so this module is unit-tested on its own.
 */

export type CalendarDate = { year: number; month: number; day: number }

export type AamvaRead =
  | {
      ok: true
      /** "ANSI" (current standard) or "AAMVA" (very old cards). */
      standard: string
      /** 6-digit issuer number: identifies the state or province that issued the card. */
      iin: string
      /** AAMVA version number (e.g. 9 or 10). */
      version: number
      documentType: 'DL' | 'ID' | 'UNKNOWN'
      dateOfBirth: CalendarDate | null
      expiryDate: CalendarDate | null
      issueDate: CalendarDate | null
      issuingState: string | null
      country: 'USA' | 'CAN' | null
    }
  | { ok: false; reason: string }

// "@" LF RS CR, then "ANSI " (or "AAMVA") + IIN (6) + version (2). Some scanners drop
// the control characters or the "@", so only the "ANSI "/"AAMVA" part is required.
const HEADER = /(ANSI ?|AAMVA)(\d{6})(\d{2})/

// Element ids are "D" + two capital letters (e.g. DBB = date of birth).
const ELEMENT = /^D[A-Z]{2}/

function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * AAMVA dates are 8 digits: US cards use MMDDCCYY, Canadian cards (and very old US
 * cards) use CCYYMMDD. The preferred order is tried first, then the other one.
 */
export function parseAamvaDate(raw: string | undefined, yearFirst: boolean): CalendarDate | null {
  const s = raw?.trim()
  if (!s || !/^\d{8}$/.test(s)) return null
  const mdy = { month: +s.slice(0, 2), day: +s.slice(2, 4), year: +s.slice(4, 8) }
  const ymd = { year: +s.slice(0, 4), month: +s.slice(4, 6), day: +s.slice(6, 8) }
  const order = yearFirst ? [ymd, mdy] : [mdy, ymd]
  return order.find((d) => isRealDate(d.year, d.month, d.day)) ?? null
}

/** Splits the barcode text into element id → value (first occurrence wins). */
function readElements(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (let line of text.split(/[\n\r\u001e]+/)) {
    line = line.trim()
    // The first element of a subfile follows the subfile type directly ("DLDAQ…").
    if (/^(DL|ID)D[A-Z]{2}/.test(line)) line = line.slice(2)
    const m = ELEMENT.exec(line)
    if (m && !out.has(m[0])) out.set(m[0], line.slice(3).trim())
  }
  return out
}

export function readAamvaBarcode(text: string): AamvaRead {
  if (!text || text.length < 30) return { ok: false, reason: 'Not an ID barcode' }
  const header = HEADER.exec(text)
  if (!header) return { ok: false, reason: 'Not an ID barcode' }

  const el = readElements(text.slice(header.index))
  const countryRaw = el.get('DCG')?.toUpperCase()
  const country = countryRaw === 'USA' || countryRaw === 'CAN' ? countryRaw : null
  // Canadian cards and AAMVA version 1 use year-first dates.
  const version = Number(header[3])
  const yearFirst = country === 'CAN' || version <= 1

  const docMatch = /(DL|ID)\d{8}/.exec(text.slice(header.index))
  const read: Extract<AamvaRead, { ok: true }> = {
    ok: true,
    standard: header[1].trim(),
    iin: header[2],
    version,
    documentType: docMatch ? (docMatch[1] as 'DL' | 'ID') : 'UNKNOWN',
    dateOfBirth: parseAamvaDate(el.get('DBB'), yearFirst),
    expiryDate: parseAamvaDate(el.get('DBA'), yearFirst),
    issueDate: parseAamvaDate(el.get('DBD'), yearFirst),
    issuingState: el.get('DAJ')?.slice(0, 2).toUpperCase() || null,
    country,
  }
  if (!read.dateOfBirth && !read.expiryDate) return { ok: false, reason: 'Not an ID barcode' }
  return read
}

/**
 * The automatic decision. No manual override: anything other than VERIFIED means the
 * delivery can't be marked delivered and the sale doesn't go through.
 */
export type IdCheckStatus = 'VERIFIED' | 'UNDER_AGE' | 'EXPIRED' | 'INVALID'

/** What Pleros stores about an ID check: no name, date of birth or licence number. */
export type IdCheckRecord = {
  method: 'LICENCE_BARCODE'
  result: IdCheckStatus
  minimumAge: number
  ageRequirementMet: boolean
  idExpiryOk: boolean
  issuingState: string | null
  checkedAt: string
}

export type IdCheckResult = {
  status: IdCheckStatus
  /** Short message for the driver or cashier. */
  message: string
  minimumAge: number
  record: IdCheckRecord
  /** What was read, for logs and tests only. Never stored or sent back to a screen. */
  read: AamvaRead
  age: number | null
}

/** The calendar day in the company's time zone (servers run in UTC): it decides birthdays and expiry. */
function todayParts(now: Date, timeZone?: string): CalendarDate {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(now)
      const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
      return { year: get('year'), month: get('month'), day: get('day') }
    } catch {
      // An unknown time zone name falls back to the server's calendar day.
    }
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
}

function compare(a: CalendarDate, b: CalendarDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day
}

/** Whole years between the date of birth and today (birthday counts on the day). */
export function ageOn(dob: CalendarDate, today: CalendarDate): number {
  let age = today.year - dob.year
  if (today.month < dob.month || (today.month === dob.month && today.day < dob.day)) age -= 1
  return age
}

export function checkIdBarcode(
  text: string,
  opts: { minimumAge: number; now?: Date; timeZone?: string },
): IdCheckResult {
  const now = opts.now ?? new Date()
  const today = todayParts(now, opts.timeZone)
  const read = readAamvaBarcode(text)

  const result = (status: IdCheckStatus, message: string, age: number | null, expiryOk: boolean): IdCheckResult => ({
    status,
    message,
    minimumAge: opts.minimumAge,
    age,
    read,
    record: {
      method: 'LICENCE_BARCODE',
      result: status,
      minimumAge: opts.minimumAge,
      ageRequirementMet: status === 'VERIFIED',
      idExpiryOk: expiryOk,
      issuingState: read.ok ? read.issuingState : null,
      checkedAt: now.toISOString(),
    },
  })

  if (!read.ok) return result('INVALID', `${read.reason}. Scan the barcode on the back of a driver's licence or state ID.`, null, false)
  if (!read.dateOfBirth) return result('INVALID', 'No date of birth on this ID.', null, false)
  if (!read.expiryDate) return result('INVALID', 'No expiry date on this ID.', null, false)

  // Valid through the expiry date itself.
  const expiryOk = compare(read.expiryDate, today) >= 0
  if (!expiryOk) return result('EXPIRED', 'This ID has expired.', null, false)

  const age = ageOn(read.dateOfBirth, today)
  if (age < 0 || age > 120) return result('INVALID', 'The date of birth on this ID is not valid.', null, true)
  if (age < opts.minimumAge) return result('UNDER_AGE', `Under ${opts.minimumAge}. Do not hand over age-restricted items.`, age, true)
  return result('VERIFIED', `ID verified · ${opts.minimumAge}+`, age, true)
}
