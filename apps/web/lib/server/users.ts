import bcrypt from 'bcrypt'
import { authDb } from './db'
import { ApiError } from './session'

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
  return authDb.user.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, email: true, isActive: true },
  })
}
