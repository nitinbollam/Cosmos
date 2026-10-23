/**
 * PLR-156: accounting period boundaries in a tenant's time zone.
 *
 * Journal `postedAt` is a UTC instant. A period is a calendar range in the tenant's zone, so it must
 * be converted to a half-open UTC interval [start, endExclusive). Using `new Date(y, m, 1)` instead
 * silently uses the SERVER's zone, so the same books produced different periods on different hosts.
 * Half-open intervals also remove the "23:59:59.999" gap/overlap between adjacent periods.
 */

export type PeriodType = 'MONTHLY' | 'QUARTERLY' | 'YEARLY'

export type PeriodRange = { start: Date; endExclusive: Date }

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Offset of `timeZone` from UTC at the given instant, in ms (positive east of UTC). */
function offsetMs(instantMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const p: Record<string, number> = {}
  for (const part of fmt.formatToParts(new Date(Math.floor(instantMs / 1000) * 1000))) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instantMs / 1000) * 1000
}

/** The UTC instant at which local midnight of (year, monthIndex0, day) occurs in `timeZone`. */
export function zonedMidnight(year: number, monthIndex0: number, day: number, timeZone: string): Date {
  const wall = Date.UTC(year, monthIndex0, day)
  let t = wall - offsetMs(wall, timeZone)
  const corrected = wall - offsetMs(t, timeZone) // second pass handles DST changes near midnight
  if (corrected !== t) t = corrected
  return new Date(t)
}

export function periodRange(
  timeZone: string,
  year: number,
  periodType: PeriodType,
  opts: { month?: number; quarter?: number } = {},
): PeriodRange {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'Etc/UTC'
  if (periodType === 'YEARLY') {
    return { start: zonedMidnight(year, 0, 1, tz), endExclusive: zonedMidnight(year + 1, 0, 1, tz) }
  }
  if (periodType === 'QUARTERLY') {
    const q = Math.max(1, Math.min(4, opts.quarter ?? 1))
    const m0 = (q - 1) * 3
    return { start: zonedMidnight(year, m0, 1, tz), endExclusive: zonedMidnight(year, m0 + 3, 1, tz) }
  }
  const m0 = Math.max(1, Math.min(12, opts.month ?? 1)) - 1
  return { start: zonedMidnight(year, m0, 1, tz), endExclusive: zonedMidnight(year, m0 + 1, 1, tz) }
}
