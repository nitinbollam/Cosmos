/**
 * Rules for changing an order at the customer's door (PLR-166): the customer takes less than was
 * shipped. Pure functions, no DB, so they can be tested on their own.
 *
 * A reduction is a credit memo against the shipped order, so the order, invoice and ledger stay
 * equal. Who did it, why and which memo it produced is kept on the stop so a dispute can be
 * answered later.
 */

const isDriver = (role: string) => role.toUpperCase() === 'DRIVER'

export const MAX_ADJUSTMENT_REASON_LENGTH = 500
export const MAX_ADJUSTMENT_LINES = 100

export type DoorAdjustmentLine = { lineItemId: string; quantity: number }

export type DoorAdjustment = { reason: string; lines: DoorAdjustmentLine[] }

export type DoorAdjustmentRecord = {
  at: string
  by: string
  reason: string
  memoId: string
  memoNumber: string
  total: string
  lines: DoorAdjustmentLine[]
}

/** Why a request is not acceptable, or null when it is. */
export function adjustmentProblem(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>
  const reason = typeof b.reason === 'string' ? b.reason.trim() : ''
  if (!reason) return 'A reason is required to change an order at the door'
  if (reason.length > MAX_ADJUSTMENT_REASON_LENGTH) {
    return `The reason must be ${MAX_ADJUSTMENT_REASON_LENGTH} characters or fewer`
  }
  if (!Array.isArray(b.lines) || b.lines.length === 0) return 'Choose at least one item to reduce'
  if (b.lines.length > MAX_ADJUSTMENT_LINES) return 'Too many lines in one change'
  const seen = new Set<string>()
  for (const raw of b.lines) {
    const l = (raw ?? {}) as Record<string, unknown>
    if (typeof l.lineItemId !== 'string' || !l.lineItemId) return 'Every line needs an item'
    if (seen.has(l.lineItemId)) return 'An item can only appear once in a change'
    seen.add(l.lineItemId)
    if (typeof l.quantity !== 'number' || !Number.isInteger(l.quantity) || l.quantity <= 0) {
      return 'Quantities must be whole numbers above zero'
    }
  }
  return null
}

/** The validated request. Call `adjustmentProblem` first. */
export function normalizeAdjustment(body: unknown): DoorAdjustment {
  const b = body as { reason: string; lines: Array<{ lineItemId: string; quantity: number }> }
  return {
    reason: b.reason.trim(),
    lines: b.lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity })),
  }
}

/** Pre-tax value of the units being taken off, in cents. Used only to compare against the threshold. */
export function reductionValueCents(
  lines: DoorAdjustmentLine[],
  items: Array<{ id: string; unitPrice: number | string | { toString(): string } }>,
): number {
  let cents = 0
  for (const l of lines) {
    const item = items.find((i) => i.id === l.lineItemId)
    if (!item) continue
    cents += Math.round(Number(item.unitPrice.toString()) * 100) * l.quantity
  }
  return cents
}

/**
 * A driver may not make a change worth more than the tenant's threshold on their own; a manager
 * must. A threshold of 0 (the default) means no limit. Non-drivers are never held back here.
 */
export function needsManager(role: string, valueCents: number, thresholdAmount: number): boolean {
  if (!isDriver(role)) return false
  if (!(thresholdAmount > 0)) return false
  return valueCents > Math.round(thresholdAmount * 100)
}

export function adjustmentsFromPod(pod: unknown): DoorAdjustmentRecord[] {
  if (!pod || typeof pod !== 'object') return []
  const a = (pod as { adjustments?: unknown }).adjustments
  return Array.isArray(a) ? (a as DoorAdjustmentRecord[]) : []
}

/** POD JSON with the adjustment appended; everything else on the stop is kept. */
export function podWithAdjustment(existingPod: unknown, record: DoorAdjustmentRecord): Record<string, unknown> {
  const base = existingPod && typeof existingPod === 'object' ? (existingPod as Record<string, unknown>) : {}
  return { ...base, adjustments: [...adjustmentsFromPod(existingPod), record] }
}
