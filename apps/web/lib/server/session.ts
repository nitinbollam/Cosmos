import { jwtVerify } from 'jose'
import { jwtSecret } from './env'

export type SessionUser = {
  userId: string
  tenantId: string
  email: string
  role: string
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
    return {
      userId: sub,
      tenantId,
      email: typeof email === 'string' ? email : '',
      role: typeof role === 'string' ? role : 'STAFF',
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
  const msg = e instanceof Error ? e.message : 'Internal server error'
  const status = msg.includes('not found') ? 404 : msg.includes('required') ? 400 : 500
  return Response.json({ message: msg }, { status })
}
