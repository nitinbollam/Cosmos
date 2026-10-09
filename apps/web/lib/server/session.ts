import { jwtVerify } from 'jose'
import { jwtSecret } from './env'

export type SessionUser = {
  userId: string
  tenantId: string
  email: string
  role: string
  permissions?: string[]
  /** AuthSession id; absent only on tokens issued before per-device sessions existed. */
  sessionId?: string
}

/**
 * Short-lived cache of DB user and session state so deactivations, role changes,
 * logouts and password resets take effect within a minute without a DB round trip
 * on every request.
 */
const STATE_TTL_MS = 60_000
const userStateCache = new Map<string, { at: number; active: boolean; role: string; permissions: string[] }>()
const authSessionCache = new Map<string, { at: number; userId: string; live: boolean }>()

function authUnavailable(): ApiError {
  // 503, not 401: a 401 makes clients drop their tokens, which would sign everyone out during a DB blip.
  return new ApiError(503, 'Authentication service unavailable')
}

async function revalidateUser(
  userId: string,
  tenantId: string,
): Promise<{ active: boolean; role: string; permissions: string[] }> {
  const cached = userStateCache.get(userId)
  if (cached && Date.now() - cached.at < STATE_TTL_MS) return cached
  let user: { isActive: boolean; role: string; permissions: unknown } | null
  try {
    const { authDb } = await import('./db')
    user = await authDb.user.findFirst({
      where: { id: userId, tenantId },
      select: { isActive: true, role: true, permissions: true },
    })
  } catch {
    throw authUnavailable()
  }
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
}

async function isAuthSessionLive(sessionId: string, userId: string): Promise<boolean> {
  const cached = authSessionCache.get(sessionId)
  if (cached && Date.now() - cached.at < STATE_TTL_MS) return cached.live && cached.userId === userId
  let row: { userId: string; revokedAt: Date | null; expiresAt: Date } | null
  try {
    const { authDb } = await import('./db')
    row = await authDb.authSession.findUnique({
      where: { id: sessionId },
      select: { userId: true, revokedAt: true, expiresAt: true },
    })
  } catch {
    throw authUnavailable()
  }
  const live = Boolean(row && !row.revokedAt && row.expiresAt.getTime() > Date.now())
  authSessionCache.set(sessionId, { at: Date.now(), userId: row?.userId ?? userId, live })
  if (authSessionCache.size > 20000) authSessionCache.clear()
  return live && row?.userId === userId
}

/** Tests and admin actions can force the next request to re-read the DB. */
export function invalidateUserSessionCache(userId?: string) {
  if (!userId) {
    userStateCache.clear()
    authSessionCache.clear()
    return
  }
  userStateCache.delete(userId)
  for (const [sid, entry] of authSessionCache) {
    if (entry.userId === userId) authSessionCache.delete(sid)
  }
}

export function invalidateAuthSessionCache(sessionId: string) {
  authSessionCache.delete(sessionId)
}

/**
 * Returns the signed-in user, or null when there is no valid access token.
 * Throws ApiError(503) when the auth database can't be reached, so callers never
 * mistake an outage for a signed-out user.
 */
export async function getSession(req: Request): Promise<SessionUser | null> {
  const auth = req.headers.get('authorization')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null

  let payload: Awaited<ReturnType<typeof jwtVerify>>['payload']
  try {
    ;({ payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret())))
  } catch {
    return null
  }
  // Refresh tokens only work at /auth/refresh. Tokens issued before `typ` existed have no claim.
  if (payload.typ === 'refresh') return null
  const sub = payload.sub
  const tenantId = payload.tenantId
  const email = payload.email
  const sessionId = typeof payload.sid === 'string' ? payload.sid : undefined
  if (typeof sub !== 'string' || typeof tenantId !== 'string') return null

  const state = await revalidateUser(sub, tenantId)
  if (!state.active) return null
  if (sessionId && !(await isAuthSessionLive(sessionId, sub))) return null

  return {
    userId: sub,
    tenantId,
    email: typeof email === 'string' ? email : '',
    // DB role and permissions win so demotions and permission resets don't wait for token
    // expiry. An empty permission list means "role defaults" (see hasPermission).
    role: state.role,
    permissions: state.permissions,
    sessionId,
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
