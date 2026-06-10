import { authDb } from './db'
import { ApiError, invalidateUserSessionCache } from './session'

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
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    }),
    authDb.user.count({ where: { tenantId } }),
  ])
  return { items, total, page, pageSize, hasMore: page * pageSize < total }
}

export async function deactivateUser(tenantId: string, id: string) {
  const user = await authDb.user.findFirst({ where: { id, tenantId } })
  if (!user) throw new ApiError(404, 'User not found')
  const updated = await authDb.user.update({
    where: { id },
    // Clearing the refresh token forces re-login; session revalidation rejects within a minute.
    data: { isActive: false, refreshTokenHash: null },
    select: { id: true, email: true, isActive: true },
  })
  invalidateUserSessionCache(id)
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
  patch: { role?: string; isActive?: boolean },
  performedBy: string,
) {
  const user = await authDb.user.findFirst({ where: { id, tenantId } })
  if (!user) throw new ApiError(404, 'User not found')

  if (patch.role !== undefined && !(ASSIGNABLE_ROLES as readonly string[]).includes(patch.role)) {
    throw new ApiError(400, `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`)
  }
  if (id === performedBy && patch.role !== undefined && user.role === 'TENANT_ADMIN' && patch.role !== 'TENANT_ADMIN') {
    throw new ApiError(400, 'You cannot demote your own admin account')
  }

  const updated = await authDb.user.update({
    where: { id },
    data: {
      ...(patch.role !== undefined ? { role: patch.role as never } : {}),
      ...(patch.isActive !== undefined
        ? { isActive: patch.isActive, ...(patch.isActive ? {} : { refreshTokenHash: null }) }
        : {}),
    },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  })
  invalidateUserSessionCache(id)
  return updated
}
