/**
 * Who the assign dropdowns offer (ClickUp 33). Mirrors the server's rules in
 * apps/web/lib/server/assignee-rules.ts, which refuse anyone else.
 */
export const ROUTE_DRIVER_ROLES = ['DRIVER'] as const
export const PICKER_ROLES = ['WAREHOUSE_STAFF'] as const

type Assignable = { role?: string | null; isActive?: boolean | null }

/** Active users with one of `roles`. A user whose role or status is unknown is left out. */
export function assignableUsers<U extends Assignable>(users: readonly U[], roles: readonly string[]): U[] {
  return users.filter((u) => u.isActive !== false && !!u.role && roles.includes(u.role))
}
