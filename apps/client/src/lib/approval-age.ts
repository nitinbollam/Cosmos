/** How long something has been waiting for a decision, and how urgent that is (ticket 64). */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Same thresholds as the server's reminder (2 days) and escalation (5 days). */
export const REMIND_AFTER_DAYS = 2
export const ESCALATE_AFTER_DAYS = 5

export type WaitLevel = 'ok' | 'reminded' | 'escalated'

export function waitingDays(since: string | Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS))
}

/** "Just now", "5 hours", "1 day", "28 days". */
export function waitingLabel(since: string | Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(since).getTime())
  if (ms < HOUR_MS) return 'Just now'
  if (ms < DAY_MS) {
    const h = Math.floor(ms / HOUR_MS)
    return `${h} hour${h === 1 ? '' : 's'}`
  }
  const d = Math.floor(ms / DAY_MS)
  return `${d} day${d === 1 ? '' : 's'}`
}

export function waitLevel(since: string | Date, now: Date = new Date()): WaitLevel {
  const d = waitingDays(since, now)
  if (d >= ESCALATE_AFTER_DAYS) return 'escalated'
  if (d >= REMIND_AFTER_DAYS) return 'reminded'
  return 'ok'
}

type CountLike = { status: string; scheduledFor: string | null; submittedAt?: string | null; updatedAt?: string | null }

/**
 * Why a cycle count needs attention, or null: scheduled for a day that has passed and still not submitted,
 * or submitted and waiting for approval for 2 days or more.
 */
export function countOverdueReason(c: CountLike, now: Date = new Date()): string | null {
  if ((c.status === 'DRAFT' || c.status === 'IN_PROGRESS') && c.scheduledFor) {
    const due = new Date(c.scheduledFor)
    const endOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1)
    if (now >= endOfDue) return `Overdue: scheduled ${due.toLocaleDateString()}`
  }
  // Counts submitted before submittedAt existed fall back to their last change, which was the submit.
  const since = c.submittedAt ?? c.updatedAt
  if (c.status === 'PENDING_APPROVAL' && since && waitingDays(since, now) >= REMIND_AFTER_DAYS) {
    return `Waiting ${waitingLabel(since, now)} for approval`
  }
  return null
}
