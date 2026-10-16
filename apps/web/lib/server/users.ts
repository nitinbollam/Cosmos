import { authDb } from './db'
import { ApiError, invalidateUserSessionCache, type SessionUser } from './session'
import { hasPermission } from './permissions'
import { revokeAllUserSessions } from './auth'

export async function listUsers(tenantId: string, page = 1, pageSize = 20) {
  const [items, total] = await Promise.all([
    authDb.user.findMany({
      where: { tenantId },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        permissions: true,
        isActive: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    authDb.user.count({ where: { tenantId } }),
  ])
  const sessions = await authDb.authSession.groupBy({
    by: ['userId'],
    where: { userId: { in: items.map((u) => u.id) }, revokedAt: null, expiresAt: { gt: new Date() } },
    _count: { _all: true },
  })
  const sessionsByUser = new Map(sessions.map((s) => [s.userId, s._count._all]))
  return {
    items: items.map(({ emailVerifiedAt, ...u }) => ({
      ...u,
      emailVerified: Boolean(emailVerifiedAt),
      activeSessions: sessionsByUser.get(u.id) ?? 0,
      permissions: Array.isArray(u.permissions)
        ? (u.permissions as string[])
        : typeof u.permissions === 'string'
          ? JSON.parse(u.permissions)
          : [],
    })),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  }
}

/** Super admins are platform accounts: only the server CLI (npm run users) may change them. */
function assertNotSuperAdmin(user: { role: string }) {
  if (user.role === 'SUPER_ADMIN') {
    throw new ApiError(403, 'Super admin accounts are managed from the server CLI (npm run users)')
  }
}

export async function deactivateUser(tenantId: string, id: string, actorRole: string) {
  const user = await authDb.user.findFirst({ where: { id, tenantId } })
  if (!user) throw new ApiError(404, 'User not found')
  assertNotSuperAdmin(user)
  assertCanManageUser(user.role, actorRole)
  const updated = await authDb.user.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, email: true, isActive: true },
  })
  // Ending the sessions stops refresh; session revalidation rejects open access tokens within a minute.
  await revokeAllUserSessions(id)
  return updated
}

/** Roles a tenant can hand out. SUPER_ADMIN is Pleros-internal and can never be granted from inside a tenant. */
export const ASSIGNABLE_ROLES = [
  'TENANT_ADMIN',
  'MANAGER',
  'WAREHOUSE_STAFF',
  'SALES_REP',
  'DRIVER',
  'ACCOUNTANT',
  'VIEWER',
  'STAFF',
] as const

const TENANT_ADMIN_GRANTORS = ['SUPER_ADMIN', 'TENANT_ADMIN']

/**
 * Throws unless `role` may be granted by someone with `grantorRole`: it must be a tenant role,
 * and only admins can make someone an admin (a manager with custom user rights cannot).
 */
export function assertGrantableRole(role: string, grantorRole: string) {
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    throw new ApiError(400, `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`)
  }
  if (role === 'TENANT_ADMIN' && !TENANT_ADMIN_GRANTORS.includes(grantorRole)) {
    throw new ApiError(403, 'Only an administrator can grant the Tenant Admin role')
  }
}

/**
 * Only administrators act on administrators: otherwise a manager with user rights could take an
 * admin's account (reset its password, change its role or permissions) or lock the admin out.
 */
export function assertCanManageUser(targetRole: string, actorRole: string) {
  if (targetRole === 'TENANT_ADMIN' && !TENANT_ADMIN_GRANTORS.includes(actorRole)) {
    throw new ApiError(403, "Only an administrator can change an administrator's account")
  }
}

/**
 * Custom permissions are full access in all but name when they include `*` or a module wildcard,
 * so a non-admin may only hand out permissions they hold themselves.
 */
function assertGrantablePermissions(permissions: string[], actor: SessionUser) {
  if (TENANT_ADMIN_GRANTORS.includes(actor.role)) return
  const notHeld = permissions.filter((p) => !hasPermission(actor, p))
  if (notHeld.length > 0) {
    throw new ApiError(403, `You can only grant permissions you have yourself (not: ${notHeld.join(', ')})`)
  }
}

export async function updateUser(
  tenantId: string,
  id: string,
  patch: { role?: string; isActive?: boolean; permissions?: string[] },
  actor: SessionUser,
) {
  const user = await authDb.user.findFirst({ where: { id, tenantId } })
  if (!user) throw new ApiError(404, 'User not found')
  assertNotSuperAdmin(user)
  assertCanManageUser(user.role, actor.role)

  if (patch.role !== undefined) assertGrantableRole(patch.role, actor.role)
  if (id === actor.userId && patch.role !== undefined && user.role === 'TENANT_ADMIN' && patch.role !== 'TENANT_ADMIN') {
    throw new ApiError(400, 'You cannot demote your own admin account')
  }
  if (patch.permissions !== undefined) {
    if (!Array.isArray(patch.permissions) || !patch.permissions.every((p) => typeof p === 'string')) {
      throw new ApiError(400, 'Permissions must be an array of strings')
    }
    assertGrantablePermissions(patch.permissions, actor)
  }

  const updated = await authDb.user.update({
    where: { id },
    data: {
      ...(patch.role !== undefined ? { role: patch.role as never } : {}),
      ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      permissions: true,
      isActive: true,
    },
  })
  if (patch.isActive === false) await revokeAllUserSessions(id)
  else invalidateUserSessionCache(id)
  return {
    ...updated,
    permissions: Array.isArray(updated.permissions)
      ? (updated.permissions as string[])
      : typeof updated.permissions === 'string'
        ? JSON.parse(updated.permissions)
        : [],
  }
}
