/**
 * Who can be given a route, a van or a pick task (ClickUp 33).
 *
 * Users live in the auth database and routes/vans/tasks elsewhere, so nothing at the
 * database level stops a route pointing at a customer account, a user from another
 * company or an id that doesn't exist. These rules are checked before saving instead.
 *
 * Kept free of DB and session imports so it can be unit-tested on its own.
 */
export type AssigneeRule = {
  /** Roles that may be assigned. */
  roles: readonly string[]
  /** Who may be assigned, for messages, e.g. "drivers". */
  who: string
  /** What is being assigned, e.g. "a route". */
  target: string
}

export const ROUTE_DRIVER_RULE: AssigneeRule = { roles: ['DRIVER'], who: 'drivers', target: 'a route' }
export const VAN_DRIVER_RULE: AssigneeRule = { roles: ['DRIVER'], who: 'drivers', target: 'a van' }
/** Warehouse staff only. A manager who wants to pick claims the task instead (see `pickAccess`). */
export const PICKER_RULE: AssigneeRule = { roles: ['WAREHOUSE_STAFF'], who: 'warehouse staff', target: 'a pick task' }

export type AssigneeCandidate = {
  tenantId: string
  role: string
  isActive: boolean
  firstName?: string | null
  lastName?: string | null
  email: string
}

// STAFF is a portal buyer (a customer's login), not an employee.
const ROLE_NAMES: Record<string, string> = {
  SUPER_ADMIN: 'a platform admin',
  TENANT_ADMIN: 'a company admin',
  MANAGER: 'a manager',
  WAREHOUSE_STAFF: 'warehouse staff',
  SALES_REP: 'a sales rep',
  DRIVER: 'a driver',
  ACCOUNTANT: 'an accountant',
  VIEWER: 'a viewer',
  STAFF: 'a customer account',
}

function displayName(u: AssigneeCandidate): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email
}

function roleName(role: string): string {
  return ROLE_NAMES[role] ?? role.toLowerCase().replace(/_/g, ' ')
}

/**
 * Why this user can't be assigned, or null when they can. `user` is the lookup result
 * for the requested id (null when there is no such user).
 */
export function assigneeProblem(
  user: AssigneeCandidate | null,
  tenantId: string,
  rule: AssigneeRule,
): string | null {
  // Another company's user is reported the same as a missing one, so ids can't be probed.
  if (!user || user.tenantId !== tenantId) return 'That user was not found in this company'
  const name = displayName(user)
  if (!user.isActive) return `${name} is deactivated and can't be assigned ${rule.target}`
  if (!rule.roles.includes(user.role)) {
    return `${name} is ${roleName(user.role)}. Only ${rule.who} can be assigned ${rule.target}`
  }
  return null
}
