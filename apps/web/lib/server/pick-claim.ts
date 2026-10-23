/**
 * Who may pick a task, and in what order tasks are offered (PLR-169). Pure, no DB.
 *
 * A task is picked by one person at a time. They get it by claiming it (or a manager assigns it).
 * Anyone else is refused, except a manager, and except when the holder has gone quiet for longer
 * than the tenant's timeout: then a colleague may take it over.
 */

export const MANAGER_ROLES = ['MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN'] as const
export const isManagerRole = (role: string) => (MANAGER_ROLES as readonly string[]).includes(role.toUpperCase())

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 }
export const priorityRank = (p: string | null | undefined) => PRIORITY_RANK[(p ?? 'NORMAL').toUpperCase()] ?? 2

/** Urgent first, then the oldest waiting. */
export function compareTasks(
  a: { priority: string | null; createdAt: Date },
  b: { priority: string | null; createdAt: Date },
): number {
  return priorityRank(a.priority) - priorityRank(b.priority) || a.createdAt.getTime() - b.createdAt.getTime()
}

export type AssignedFilter = 'mine' | 'unassigned' | 'all'

export function parseAssignedFilter(raw: string | null | undefined): AssignedFilter {
  const v = (raw ?? '').trim().toLowerCase()
  return v === 'mine' || v === 'unassigned' ? v : 'all'
}

export function matchesAssigned(filter: AssignedFilter, assignedUserId: string | null, viewerId: string): boolean {
  if (filter === 'mine') return assignedUserId === viewerId
  if (filter === 'unassigned') return assignedUserId === null
  return true
}

export function isStale(lastActivity: Date, now: Date, staleMinutes: number): boolean {
  if (!(staleMinutes > 0)) return false
  return now.getTime() - lastActivity.getTime() > staleMinutes * 60_000
}

export type PickAccess = 'OK' | 'CLAIM_FIRST' | 'DENIED'

/** What an actor may do to a task's pick lines right now. */
export function pickAccess(task: { assignedUserId: string | null }, actor: { userId: string; role: string }): PickAccess {
  if (isManagerRole(actor.role)) return 'OK'
  if (task.assignedUserId === null) return 'CLAIM_FIRST'
  return task.assignedUserId === actor.userId ? 'OK' : 'DENIED'
}

/** Whether a claim should succeed: free, already yours, or the holder has gone quiet. */
export function claimable(
  task: { assignedUserId: string | null; updatedAt: Date },
  userId: string,
  now: Date,
  staleMinutes: number,
): boolean {
  if (task.assignedUserId === null || task.assignedUserId === userId) return true
  return isStale(task.updatedAt, now, staleMinutes)
}
