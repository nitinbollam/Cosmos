/**
 * Money a driver takes at the door (cash or cheque) for an order that is paid on delivery, and the
 * day's cash expectations (PLR-165 follow-ups). Pure, so each rule is tested without a database.
 * Money is held as integer cents.
 */
import { toCents } from './money'
import { vanSalesFromPod } from './van-rules'

export const COLLECT_METHODS = ['CASH', 'CHECK'] as const
export type CollectMethod = (typeof COLLECT_METHODS)[number]

export type CollectionRecord = {
  at: string
  by: string
  orderId: string
  /** Decimal string, exact. */
  amount: string
  method: CollectMethod
  /** Cheque number. */
  reference?: string
}

export function collectionsFromPod(pod: unknown): CollectionRecord[] {
  if (!pod || typeof pod !== 'object') return []
  const v = (pod as { collections?: unknown }).collections
  return Array.isArray(v) ? (v as CollectionRecord[]) : []
}

/** POD JSON with the collection appended; everything else on the stop is kept. */
export function podWithCollection(existingPod: unknown, record: CollectionRecord): Record<string, unknown> {
  const base = existingPod && typeof existingPod === 'object' ? (existingPod as Record<string, unknown>) : {}
  return { ...base, collections: [...collectionsFromPod(existingPod), record] }
}

/** Why a collection is not acceptable, or null when it is. `remainingCents` is what the order still owes. */
export function collectionProblem(input: { amountCents: unknown; method: unknown; reference?: unknown }, remainingCents: number): string | null {
  const cents = input.amountCents
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents <= 0) return 'Enter the amount you collected'
  if (!COLLECT_METHODS.includes(input.method as CollectMethod)) return 'Collect cash or a cheque. Card and terms are not taken at the door'
  if (input.method === 'CHECK' && !(typeof input.reference === 'string' && input.reference.trim())) return 'Enter the cheque number'
  if (remainingCents <= 0) return 'This order is already paid'
  if (cents > remainingCents) return 'That is more than this order still owes'
  return null
}

/** Cash and cheques a driver should be holding for one stop's pod: van sales plus door collections. */
export function podCash(pod: unknown): { cashCents: number; checkCents: number } {
  let cash = 0
  let check = 0
  const add = (method: string, amount: string) => {
    let cents: number
    try {
      cents = toCents(amount)
    } catch {
      return // swallow-ok: a malformed amount on an old record adds nothing rather than breaking the day's report
    }
    if (method === 'CASH') cash += cents
    else if (method === 'CHECK') check += cents
  }
  for (const s of vanSalesFromPod(pod)) add(s.paymentMethod, s.total)
  for (const c of collectionsFromPod(pod)) add(c.method, c.amount)
  return { cashCents: cash, checkCents: check }
}

/** Counted less expected: negative is short, positive is over. */
export const cashVarianceCents = (expectedCents: number, countedCents: number) => countedCents - expectedCents

/** Why a day cannot be closed as counted, or null. A difference needs a note saying why. */
export function dayCloseProblem(input: { countedCents: unknown; note?: unknown }, expectedCents: number): string | null {
  const c = input.countedCents
  if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) return 'Enter the amount counted'
  if (cashVarianceCents(expectedCents, c) !== 0 && !(typeof input.note === 'string' && input.note.trim().length >= 3)) {
    return 'The count does not match what was expected. Say why'
  }
  return null
}
