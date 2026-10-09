/**
 * User management shared by Settings → Users (company admins, own company only) and the
 * `npm run users` CLI that runs inside the deployed container (Railway shell / boot bootstrap).
 *
 * Trust boundary: a company admin can only act on users in their own company, can never grant
 * the SUPER_ADMIN role or touch a SUPER_ADMIN account, and cannot act on themselves here. Only
 * the CLI — which needs access to the hosting platform — can create or change super admins.
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import { auditLog } from './audit-log'
import { revokeAllUserSessions, sendPasswordResetLink } from './auth'
import { assertPasswordPolicy } from './auth-security'
import { authDb, tenantDb } from './db'
import { ApiError, invalidateUserSessionCache } from './session'
import { createTenantOrganization } from './signup'

export const TENANT_ROLES = [
  'TENANT_ADMIN',
  'MANAGER',
  'ACCOUNTANT',
  'WAREHOUSE_STAFF',
  'SALES_REP',
  'DRIVER',
  'VIEWER',
  'STAFF',
] as const

export const ALL_ROLES = ['SUPER_ADMIN', ...TENANT_ROLES] as const

/** Tenant that owns platform super admins created by the bootstrap. */
export const PLATFORM_TENANT_SLUG = 'pleros-ops'

export type Actor = { kind: 'tenant-admin'; userId: string; tenantId: string } | { kind: 'cli'; label: string }

export type ManagedUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  emailVerified: boolean
  lastLoginAt: Date | null
  createdAt: Date
  tenant: { id: string; name: string; slug: string } | null
  activeSessions: number
}

type UserRecord = {
  id: string
  tenantId: string
  email: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
  emailVerifiedAt: Date | null
}

/** Random password that satisfies the password policy; shown once, then the user changes it. */
export function generateTemporaryPassword(): string {
  return `${randomBytes(12).toString('base64url')}-7k`
}

function assertGrantable(role: string, actor: Actor) {
  if (!(ALL_ROLES as readonly string[]).includes(role)) {
    throw new ApiError(400, `Role must be one of: ${ALL_ROLES.join(', ')}`)
  }
  if (role === 'SUPER_ADMIN' && actor.kind !== 'cli') {
    throw new ApiError(403, 'Platform super admins can only be created from the server CLI')
  }
}

/**
 * Company admins act only inside their own company (anything else looks like it doesn't exist),
 * never on super admins, and never on their own account.
 */
function assertCanManage(target: UserRecord, actor: Actor, opts: { allowSelf?: boolean } = {}) {
  if (actor.kind === 'cli') return
  if (target.tenantId !== actor.tenantId) throw new ApiError(404, 'User not found')
  if (target.role === 'SUPER_ADMIN') {
    throw new ApiError(403, 'Super admin accounts can only be changed from the server CLI')
  }
  if (!opts.allowSelf && target.id === actor.userId) {
    throw new ApiError(400, 'You cannot change your own account here')
  }
}

async function audit(target: UserRecord, actor: Actor, action: string, metadata: Record<string, unknown> = {}) {
  await auditLog(target.tenantId, {
    action: `ops.user.${action}`,
    entityType: 'user',
    entityId: target.id,
    userId: actor.kind === 'tenant-admin' ? actor.userId : undefined,
    metadata: { via: actor.kind, ...(actor.kind === 'cli' ? { operator: actor.label } : {}), ...metadata },
  }).catch((err) => console.error('[user-admin] audit write failed:', err))
}

async function loadUser(userId: string): Promise<UserRecord> {
  const user = await authDb.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tenantId: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
      emailVerifiedAt: true,
    },
  })
  if (!user) throw new ApiError(404, 'User not found')
  return user
}

async function toManaged(users: Array<UserRecord & { lastLoginAt: Date | null; createdAt: Date }>): Promise<ManagedUser[]> {
  const tenantIds = [...new Set(users.map((u) => u.tenantId))]
  const userIds = users.map((u) => u.id)
  const [tenants, sessions] = await Promise.all([
    authDb.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true } }),
    authDb.authSession.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, revokedAt: null, expiresAt: { gt: new Date() } },
      _count: { _all: true },
    }),
  ])
  const tenantById = new Map(tenants.map((t) => [t.id, t]))
  const sessionsByUser = new Map(sessions.map((s) => [s.userId, s._count._all]))
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    isActive: u.isActive,
    emailVerified: Boolean(u.emailVerifiedAt),
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    tenant: tenantById.get(u.tenantId) ?? null,
    activeSessions: sessionsByUser.get(u.id) ?? 0,
  }))
}

export async function getManagedUser(userId: string): Promise<ManagedUser> {
  const user = await authDb.user.findUnique({ where: { id: userId } })
  if (!user) throw new ApiError(404, 'User not found')
  return (await toManaged([user]))[0]!
}

export async function listUsers(filters: { search?: string; tenantId?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50))
  const term = filters.search?.trim()
  const where = {
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(term
      ? {
          OR: [
            { email: { contains: term.toLowerCase() } },
            { firstName: { contains: term } },
            { lastName: { contains: term } },
          ],
        }
      : {}),
  }
  const [rows, total] = await Promise.all([
    authDb.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    authDb.user.count({ where }),
  ])
  return { items: await toManaged(rows), total, page, pageSize }
}

export async function listTenants() {
  return authDb.tenant.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } })
}

/** Resolve a user by email for the CLI; asks for the tenant when the address exists in several. */
export async function findUserByEmail(email: string, tenantSlug?: string): Promise<UserRecord> {
  const normalized = email.trim().toLowerCase()
  const matches = await authDb.user.findMany({ where: { email: normalized } })
  if (matches.length === 0) throw new ApiError(404, `No user with email ${normalized}`)
  if (tenantSlug) {
    const tenant = await authDb.tenant.findFirst({ where: { slug: tenantSlug } })
    const match = matches.find((m) => m.tenantId === tenant?.id)
    if (!match) throw new ApiError(404, `No user ${normalized} in company "${tenantSlug}"`)
    return match
  }
  if (matches.length > 1) {
    const tenants = await authDb.tenant.findMany({ where: { id: { in: matches.map((m) => m.tenantId) } } })
    throw new ApiError(400, `${normalized} exists in several companies (${tenants.map((t) => t.slug).join(', ')}); pass --tenant`)
  }
  return matches[0]!
}

export type CreateUserInput = {
  email: string
  firstName: string
  lastName: string
  role: string
  password?: string
  tenantId?: string
  newTenant?: { companyName: string; slug: string }
}

export async function createUser(input: CreateUserInput, actor: Actor) {
  assertGrantable(input.role, actor)
  const email = input.email?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'A valid email is required')
  const firstName = input.firstName?.trim()
  const lastName = input.lastName?.trim()
  if (!firstName || !lastName) throw new ApiError(400, 'First and last name are required')
  if (Boolean(input.tenantId) === Boolean(input.newTenant)) {
    throw new ApiError(400, 'Choose an existing company or create a new one')
  }
  // Login looks users up by email alone, so one address in two companies makes sign-in ambiguous.
  if (await authDb.user.findFirst({ where: { email } })) {
    throw new ApiError(409, 'That email is already registered')
  }

  const temporaryPassword = input.password ? undefined : generateTemporaryPassword()
  const password = input.password ?? temporaryPassword!
  assertPasswordPolicy(password)

  let tenantId = input.tenantId
  if (tenantId) {
    if (!(await authDb.tenant.findUnique({ where: { id: tenantId } }))) throw new ApiError(404, 'Company not found')
  } else {
    tenantId = (await createTenantOrganization({ ...input.newTenant!, billingEmail: email })).tenantId
  }

  const user = await authDb.user.create({
    data: {
      tenantId,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      firstName,
      lastName,
      role: input.role as 'STAFF',
      permissions: [],
      // Created by an operator, so the address is taken as verified.
      emailVerifiedAt: new Date(),
    },
  })
  await audit(user, actor, 'create', { role: input.role, newTenant: Boolean(input.newTenant) })
  return { user: await getManagedUser(user.id), temporaryPassword }
}

export async function setPassword(userId: string, password: string | undefined, actor: Actor) {
  const user = await loadUser(userId)
  assertCanManage(user, actor)
  const temporaryPassword = password ? undefined : generateTemporaryPassword()
  const next = password ?? temporaryPassword!
  assertPasswordPolicy(next)
  await authDb.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(next, 12), passwordResetTokenHash: null, passwordResetExpiresAt: null },
  })
  // Whoever knew the old password may still be signed in.
  await revokeAllUserSessions(user.id)
  await audit(user, actor, 'set-password', { generated: Boolean(temporaryPassword) })
  return { user: await getManagedUser(user.id), temporaryPassword }
}

export async function emailPasswordReset(userId: string, actor: Actor) {
  const user = await loadUser(userId)
  assertCanManage(user, actor)
  if (!user.isActive) throw new ApiError(400, 'Reactivate the user before sending a reset link')
  await sendPasswordResetLink(user)
  await audit(user, actor, 'send-reset-link')
  return { ok: true }
}

export async function setActive(userId: string, active: boolean, actor: Actor) {
  const user = await loadUser(userId)
  assertCanManage(user, actor)
  if (!active && user.role === 'SUPER_ADMIN') await assertNotLastSuperAdmin(user.id)
  await authDb.user.update({ where: { id: user.id }, data: { isActive: active } })
  if (active) invalidateUserSessionCache(user.id)
  else await revokeAllUserSessions(user.id)
  await audit(user, actor, active ? 'activate' : 'deactivate')
  return getManagedUser(user.id)
}

export async function markEmailVerified(userId: string, actor: Actor) {
  const user = await loadUser(userId)
  assertCanManage(user, actor, { allowSelf: true })
  await authDb.user.update({
    where: { id: user.id },
    data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null },
  })
  await audit(user, actor, 'verify-email')
  return getManagedUser(user.id)
}

export async function setRole(userId: string, role: string, actor: Actor) {
  const user = await loadUser(userId)
  assertCanManage(user, actor)
  assertGrantable(role, actor)
  if (user.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') await assertNotLastSuperAdmin(user.id)
  await authDb.user.update({ where: { id: user.id }, data: { role: role as 'STAFF' } })
  invalidateUserSessionCache(user.id)
  await audit(user, actor, 'set-role', { from: user.role, to: role })
  return getManagedUser(user.id)
}

export async function revokeSessions(userId: string, actor: Actor) {
  const user = await loadUser(userId)
  assertCanManage(user, actor)
  await revokeAllUserSessions(user.id)
  await audit(user, actor, 'revoke-sessions')
  return getManagedUser(user.id)
}

async function assertNotLastSuperAdmin(excludingUserId: string) {
  const others = await authDb.user.count({
    where: { role: 'SUPER_ADMIN', isActive: true, id: { not: excludingUserId } },
  })
  if (others === 0) throw new ApiError(400, 'This is the last active super admin; create another one first')
}

/**
 * Create — or recover — a platform super admin. Used by the boot bootstrap on Railway
 * (PLEROS_BOOTSTRAP_ADMIN_EMAIL / _PASSWORD) and by `npm run users -- bootstrap`.
 * If the super admin exists, its password is reset to the one given and it is reactivated,
 * so the same variables double as account recovery.
 */
export async function bootstrapSuperAdmin(input: { email: string; password: string; firstName?: string; lastName?: string }, actor: Actor) {
  const email = input.email.trim().toLowerCase()
  assertPasswordPolicy(input.password)
  const existing = await authDb.user.findMany({ where: { email } })
  const admin = existing.find((u) => u.role === 'SUPER_ADMIN')
  if (admin) {
    await authDb.user.update({
      where: { id: admin.id },
      data: {
        passwordHash: await bcrypt.hash(input.password, 12),
        isActive: true,
        emailVerifiedAt: admin.emailVerifiedAt ?? new Date(),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
      },
    })
    await revokeAllUserSessions(admin.id)
    await audit(admin, actor, 'bootstrap-recover')
    return { status: 'updated' as const, user: await getManagedUser(admin.id) }
  }
  if (existing.length > 0) {
    throw new ApiError(409, `${email} already belongs to a non-admin user; bootstrap with a different email`)
  }

  const platform = await tenantDb.tenantOrganization.findUnique({ where: { slug: PLATFORM_TENANT_SLUG } })
  const tenantId = platform
    ? platform.id
    : (await createTenantOrganization({ companyName: 'Pleros Ops', slug: PLATFORM_TENANT_SLUG, billingEmail: email })).tenantId
  const { user } = await createUser(
    {
      email,
      firstName: input.firstName?.trim() || 'Pleros',
      lastName: input.lastName?.trim() || 'Admin',
      role: 'SUPER_ADMIN',
      password: input.password,
      tenantId,
    },
    actor,
  )
  return { status: 'created' as const, user }
}
