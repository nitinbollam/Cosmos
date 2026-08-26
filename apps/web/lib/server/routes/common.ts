import { isPortalBuyer } from '../buyer-context'
import { ApiError, requireSession, requireRole, assertRole, type SessionUser } from '../session'
import { requirePermission, assertPermission, hasPermission } from '../permissions'

export { ApiError, requireSession, requireRole, assertRole, requirePermission, assertPermission, hasPermission }
export type { SessionUser }

export const ADMIN_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN'] as const
export const CRM_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'SALES_REP', 'OPS_STAFF'] as const
export const OPS_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPS_STAFF'] as const
export const DRIVER_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN', 'OPS_STAFF', 'DRIVER'] as const

/** Routes that are internal back-office surface — portal buyers are never allowed. */
export function assertNotBuyer(session: SessionUser) {
  if (isPortalBuyer(session.role)) throw new ApiError(403, 'Forbidden')
}

export function requireIdempotencyKey(req: Request): string {
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key) throw new ApiError(400, 'Idempotency-Key header is required for payment mutations.')
  return key
}
