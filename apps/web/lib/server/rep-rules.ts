/**
 * Rules for the sales rep app (PLR-170): who may see an account, what a rep may ask for.
 * Pure functions, so each rule can be tested without a database.
 */
import { isManagerRole } from './pick-claim'

export type RepViewer = { userId: string; role: string }

/** Managers see every account; a rep sees the ones assigned to them. */
export function canSeeAccount(viewer: RepViewer, ownerUserId: string | null | undefined): boolean {
  if (isManagerRole(viewer.role)) return true
  return !!ownerUserId && ownerUserId === viewer.userId
}

/** What the customer can still buy on terms. Null means no limit is set. */
export function availableCredit(creditLimit: number | null, openBalance: number): number | null {
  if (creditLimit == null || creditLimit <= 0) return null
  return Math.round((creditLimit - openBalance) * 100) / 100
}

export type CreditRequestInput = { requestedLimit?: unknown; reason?: unknown }

/** A reason is required so the approver is not guessing; the new limit must be a real increase. */
export function creditRequestProblem(input: CreditRequestInput, currentLimit: number | null): string | null {
  const n = Number(input.requestedLimit)
  if (!Number.isFinite(n) || n <= 0) return 'Enter the credit limit you are asking for'
  if (Math.round(n * 100) !== n * 100 && Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return 'Use dollars and cents'
  if (currentLimit != null && n <= currentLimit) return `The request must be above the current limit of ${currentLimit.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
  if (typeof input.reason !== 'string' || input.reason.trim().length < 5) return 'Say why the account needs more credit'
  return null
}

export type RepLineInput = { skuId?: unknown; quantity?: unknown }

/** Reps send only what and how many. Prices always come from the server. */
export function repLinesProblem(lines: unknown): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return 'Add at least one line'
  if (lines.length > 200) return 'Too many lines'
  const seen = new Set<string>()
  for (const raw of lines as RepLineInput[]) {
    if (typeof raw?.skuId !== 'string' || !raw.skuId) return 'Every line needs an item'
    const q = Number(raw.quantity)
    if (!Number.isInteger(q) || q < 1) return 'Quantity must be a whole number of at least 1'
    if (seen.has(raw.skuId)) return 'The same item is on two lines; combine them'
    seen.add(raw.skuId)
  }
  return null
}

/** Only an open lead can be taken or converted. */
export function leadIsOpen(status: string): boolean {
  return status !== 'WON' && status !== 'LOST'
}

/** A rep may act on a lead that is theirs or that nobody owns yet. */
export function canWorkLead(viewer: RepViewer, assignedToUserId: string | null | undefined): boolean {
  if (isManagerRole(viewer.role)) return true
  return !assignedToUserId || assignedToUserId === viewer.userId
}
