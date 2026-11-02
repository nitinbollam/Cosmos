/**
 * When a receiving session may be completed or cancelled, and when an abandoned one expires.
 * Kept free of DB imports so the rules can be tested on their own.
 *
 * A session only moves stock when it is completed. So cancelling one (or letting an empty one expire) leaves stock
 * exactly as it was, and completing must happen at most once: a finished session, whatever it finished as
 * (Completed, Discrepancy, Closed), can never be completed again.
 */

/** The states in which a session can still be scanned, completed or cancelled. */
export const OPEN_RECEIVING_STATES = ['OPEN', 'IN_PROGRESS'] as const

/** Hours an open session with nothing scanned may sit untouched before it is cancelled automatically. */
export const RECEIVING_SESSION_EXPIRY_HOURS = 24

/** Why a session in this state cannot be completed, or null when it can. */
export function completionRefusal(status: string): string | null {
  if (status === 'OPEN' || status === 'IN_PROGRESS') return null
  if (status === 'CANCELLED') return 'This receiving session was cancelled, so it cannot be completed'
  // Completed, Discrepancy and Closed have all posted their stock already.
  return 'Session already completed'
}

/** Why a session in this state cannot be cancelled, or null when it can. */
export function cancelRefusal(status: string): string | null {
  if (status === 'OPEN' || status === 'IN_PROGRESS') return null
  if (status === 'CANCELLED') return 'This receiving session is already cancelled'
  return 'This receiving session is already completed; its stock has been received and cannot be cancelled'
}

/** Sessions created before this moment, with nothing scanned, are expired. */
export function expiryCutoff(now: Date, hours: number = RECEIVING_SESSION_EXPIRY_HOURS): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000)
}

/** Whether an open session with this scan history and age expires now. */
export function isExpiredEmptySession(
  s: { status: string; createdAt: Date; anyScanned: boolean },
  now: Date,
  hours: number = RECEIVING_SESSION_EXPIRY_HOURS,
): boolean {
  return (s.status === 'OPEN' || s.status === 'IN_PROGRESS') && !s.anyScanned && s.createdAt.getTime() < expiryCutoff(now, hours).getTime()
}
