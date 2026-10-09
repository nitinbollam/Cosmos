import { authDb } from './db'
import { ApiError, invalidateUserSessionCache } from './session'
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

export async function deactivateUser(tenantId: string, id: string) {
  const user = await authDb.user.findFirst({ where: { id, tenantId } })
  if (!user) throw new ApiError(404, 'User not found')
  assertNotSuperAdmin(user)
  const updated = await authDb.user.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, email: true, isActive: true },
  })
  // Ending the sessions stops refresh; session revalidation rejects open access tokens within a minute.
  await revokeAllUserSessions(id)
  return updated
}

const ASSIGNABLE_ROLES = [
  'TENANT_ADMIN',
  'MANAGER',
  'WAREHOUSE_STAFF',
  'SALES_REP',
  'DRIVER',
  'ACCOUNTANT',
  'VIEWER',
  'STAFF',
] as const

export async function updateUser(
  tenantId: string,
  id: string,
  patch: { role?: string; isActive?: boolean; permissions?: string[] },
  performedBy: string,
) {
  const user = await authDb.user.findFirst({ where: { id, tenantId } })
  if (!user) throw new ApiError(404, 'User not found')
  assertNotSuperAdmin(user)

  if (patch.role !== undefined && !(ASSIGNABLE_ROLES as readonly string[]).includes(patch.role)) {
    throw new ApiError(400, `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`)
  }
  if (id === performedBy && patch.role !== undefined && user.role === 'TENANT_ADMIN' && patch.role !== 'TENANT_ADMIN') {
    throw new ApiError(400, 'You cannot demote your own admin account')
  }
  if (patch.permissions !== undefined) {
    if (!Array.isArray(patch.permissions) || !patch.permissions.every((p) => typeof p === 'string')) {
      throw new ApiError(400, 'Permissions must be an array of strings')
    }
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
