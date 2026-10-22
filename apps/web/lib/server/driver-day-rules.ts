/**
 * Pieces of the driver-per-day report that need no database: stock variance from a van count, and
 * the tenant-local day a timestamp belongs to. Pure, so each is tested alone.
 */
import { zonedMidnight, isValidTimeZone } from './period-bounds'

export type CountLine = { skuId: string; expected: number; counted: number }

export type StockVariance = {
  unitsExpected: number
  unitsCounted: number
  unitsShort: number
  unitsOver: number
  /** Only the items that did not match. */
  lines: Array<{ skuId: string; expected: number; counted: number; difference: number }>
}

/** Counted against expected for one or more van counts. Short and over are kept apart so one cannot hide the other. */
export function stockVariance(lines: ReadonlyArray<CountLine>): StockVariance {
  const bySku = new Map<string, { expected: number; counted: number }>()
  for (const l of lines) {
    const cur = bySku.get(l.skuId) ?? { expected: 0, counted: 0 }
    cur.expected += l.expected
    cur.counted += l.counted
    bySku.set(l.skuId, cur)
  }
  const out: StockVariance = { unitsExpected: 0, unitsCounted: 0, unitsShort: 0, unitsOver: 0, lines: [] }
  for (const [skuId, v] of bySku) {
    out.unitsExpected += v.expected
    out.unitsCounted += v.counted
    const difference = v.counted - v.expected
    if (difference < 0) out.unitsShort += -difference
    if (difference > 0) out.unitsOver += difference
    if (difference !== 0) out.lines.push({ skuId, ...v, difference })
  }
  out.lines.sort((a, b) => a.difference - b.difference || a.skuId.localeCompare(b.skuId))
  return out
}

/** `YYYY-MM-DD` as a real calendar date, or null. */
export function parseBusinessDate(raw: unknown): { year: number; month: number; day: number } | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [year, month, day] = raw.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? { year, month, day } : null
}

/** [start, end) in UTC for a calendar day in the tenant's time zone. */
export function dayRange(date: string, timeZone: string | null | undefined): { start: Date; endExclusive: Date } | null {
  const p = parseBusinessDate(date)
  if (!p) return null
  const tz = timeZone && isValidTimeZone(timeZone) ? timeZone : 'Etc/UTC'
  return { start: zonedMidnight(p.year, p.month - 1, p.day, tz), endExclusive: zonedMidnight(p.year, p.month - 1, p.day + 1, tz) }
}
