/**
 * Rules for the end-of-day van return (PLR-168). Pure, no DB.
 *
 * The driver counts what is on the van. The count is compared with what the system says is there:
 * a shortage or an overage is a variance. A variance is never fixed automatically; a manager signs
 * it off with a note. Cash and cheques taken on the road are compared the same way.
 */

export type CountInput = { skuId: string; quantity: number }

export type ReturnLine = {
  skuId: string
  expected: number
  counted: number
  good?: number
  damaged?: number
}

export type LineResolution = { action: 'WRITE_OFF' | 'FOUND'; quantity: number; by: string; at: string; note: string }

export type ReturnResolution = {
  lines?: Record<string, LineResolution>
  cash?: { by: string; at: string; note: string }
}

/** Why a driver's count is not acceptable, or null when it is. */
export function countsProblem(counts: unknown, max = 500): string | null {
  if (!Array.isArray(counts)) return 'Send what you counted'
  if (counts.length > max) return 'Too many lines in one count'
  const seen = new Set<string>()
  for (const raw of counts) {
    const c = (raw ?? {}) as Record<string, unknown>
    if (typeof c.skuId !== 'string' || !c.skuId) return 'Every line needs an item'
    if (seen.has(c.skuId)) return 'An item can only appear once in a count'
    seen.add(c.skuId)
    if (typeof c.quantity !== 'number' || !Number.isInteger(c.quantity) || c.quantity < 0) {
      return 'Counts must be whole numbers, zero or more'
    }
  }
  return null
}

export function cashCountProblem(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 'Enter the cash and checks you are handing in (0 if none)'
  if (Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) return 'Cash must be in whole cents'
  return null
}

/**
 * One line per item that is expected or counted. An item the system expects but the driver did not
 * list is counted as zero: the driver must count everything on the van.
 */
export function buildReturnLines(expected: Array<{ skuId: string; quantity: number }>, counts: CountInput[]): ReturnLine[] {
  const exp = new Map(expected.map((e) => [e.skuId, e.quantity]))
  const cnt = new Map(counts.map((c) => [c.skuId, c.quantity]))
  const ids = [...new Set([...exp.keys(), ...cnt.keys()])].sort()
  return ids.map((skuId) => ({ skuId, expected: exp.get(skuId) ?? 0, counted: cnt.get(skuId) ?? 0 }))
}

export const lineVariance = (l: ReturnLine) => l.counted - l.expected

export function cashVarianceCents(cash: { expectedCents: number; countedCents: number }): number {
  return cash.countedCents - cash.expectedCents
}

/** Why an inspection is not acceptable, or null when it is. Every counted unit is good or damaged. */
export function inspectionProblem(
  lines: ReturnLine[],
  inspection: unknown,
): string | null {
  if (!Array.isArray(inspection)) return 'Send what you found for each item'
  const byId = new Map(lines.map((l) => [l.skuId, l]))
  const seen = new Set<string>()
  for (const raw of inspection) {
    const i = (raw ?? {}) as Record<string, unknown>
    const line = typeof i.skuId === 'string' ? byId.get(i.skuId) : undefined
    if (!line) return 'That item is not on this return'
    if (seen.has(line.skuId)) return 'An item can only appear once'
    seen.add(line.skuId)
    const ok = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0
    if (!ok(i.good) || !ok(i.damaged)) return 'Good and damaged must be whole numbers, zero or more'
    if ((i.good as number) + (i.damaged as number) !== line.counted) {
      return `Good plus damaged must equal the ${line.counted} counted for an item`
    }
  }
  for (const l of lines) if (l.counted > 0 && !seen.has(l.skuId)) return 'Every counted item must be inspected'
  return null
}

/** Items counted over what the system expected. These must be signed off before inspection. */
export const overageLines = (lines: ReturnLine[]) => lines.filter((l) => lineVariance(l) > 0)
export const shortageLines = (lines: ReturnLine[]) => lines.filter((l) => lineVariance(l) < 0)

/** What still needs a manager: variances not yet signed off, cash included. */
export function outstanding(
  lines: ReturnLine[],
  cash: { expectedCents: number; countedCents: number },
  resolution: ReturnResolution | null | undefined,
): { lines: string[]; cash: boolean } {
  const done = resolution?.lines ?? {}
  return {
    lines: lines.filter((l) => lineVariance(l) !== 0 && !done[l.skuId]).map((l) => l.skuId),
    cash: cashVarianceCents(cash) !== 0 && !resolution?.cash,
  }
}

export function canClose(
  status: string,
  lines: ReturnLine[],
  cash: { expectedCents: number; countedCents: number },
  resolution: ReturnResolution | null | undefined,
): boolean {
  if (status !== 'INSPECTED') return false
  const o = outstanding(lines, cash, resolution)
  return o.lines.length === 0 && !o.cash
}

export const MANAGER_ROLES = ['MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN'] as const
