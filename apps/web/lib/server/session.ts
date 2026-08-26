import { jwtVerify } from 'jose'
import { jwtSecret } from './env'

export type SessionUser = {
  userId: string
  tenantId: string
  email: string
  role: string
  permissions?: string[]
}

/**
 * Short-lived cache of DB user state so deactivations and role changes take
 * effect within a minute without a DB round trip on every request.
 */
const USER_STATE_TTL_MS = 60_000
const userStateCache = new Map<string, { at: number; active: boolean; role: string; permissions: string[] }>()

async function revalidateUser(userId: string, tenantId: string): Promise<{ active: boolean; role: string; permissions: string[] }> {
  const cached = userStateCache.get(userId)
  if (cached && Date.now() - cached.at < USER_STATE_TTL_MS) return cached
  try {
    const { authDb } = await import('./db')
    const user = await authDb.user.findFirst({
      where: { id: userId, tenantId },
      select: { isActive: true, role: true, permissions: true },
    })
    const rawPerms = user?.permissions
    const permissions: string[] = Array.isArray(rawPerms)
      ? (rawPerms as string[])
      : typeof rawPerms === 'string'
        ? JSON.parse(rawPerms)
        : []
    const state = {
      at: Date.now(),
      active: Boolean(user?.isActive),
      role: user?.role ?? 'STAFF',
      permissions,
    }
    userStateCache.set(userId, state)
    if (userStateCache.size > 5000) userStateCache.clear()
    return state
  } catch {
    // DB unavailable — fall back to the (already signature-verified) token claims.
    return { active: true, role: '', permissions: [] }
  }
}

/** Tests and admin actions can force the next request to re-read the DB. */
export function invalidateUserSessionCache(userId?: string) {
  if (userId) userStateCache.delete(userId)
  else userStateCache.clear()
}

export async function getSession(req: Request): Promise<SessionUser | null> {
  const auth = req.headers.get('authorization')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret()))
    const sub = payload.sub
    const tenantId = payload.tenantId
    const email = payload.email
    const role = payload.role
    if (typeof sub !== 'string' || typeof tenantId !== 'string') return null

    const state = await revalidateUser(sub, tenantId)
    if (!state.active) return null

    const rawTokenPerms = payload.permissions
    const tokenPerms: string[] = Array.isArray(rawTokenPerms) ? (rawTokenPerms as string[]) : []

    return {
      userId: sub,
      tenantId,
      email: typeof email === 'string' ? email : '',
      // DB role wins so demotions don't have to wait for token expiry.
      role: state.role || (typeof role === 'string' ? role : 'STAFF'),
      permissions: state.permissions && state.permissions.length > 0 ? state.permissions : tokenPerms,
    }
  } catch {
    return null
  }
}

export async function requireSession(req: Request): Promise<SessionUser> {
  const session = await getSession(req)
  if (!session) throw new ApiError(401, 'Unauthorized')
  return session
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const ADMIN_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'MANAGER', 'ACCOUNTANT'] as const
export const OPS_ROLES = [...ADMIN_ROLES, 'WAREHOUSE_STAFF'] as const
export const DRIVER_ROLES = [...ADMIN_ROLES, 'DRIVER'] as const

export function assertRole(session: SessionUser, allowed: readonly string[]) {
  if (!allowed.includes(session.role)) {
    throw new ApiError(403, 'Forbidden')
  }
}

export async function requireRole(req: Request, allowed: readonly string[]): Promise<SessionUser> {
  const session = await requireSession(req)
  assertRole(session, allowed)
  return session
}

export function toJsonError(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json({ message: e.message }, { status: e.status })
  }
  if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'P2002') {
    return Response.json({ message: 'Conflict' }, { status: 409 })
  }
  console.error('[API Uncaught Error]', e)
  return Response.json({ message: 'Internal server error' }, { status: 500 })
}
