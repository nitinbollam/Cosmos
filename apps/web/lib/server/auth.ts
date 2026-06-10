import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import * as jose from 'jose'
import { assertPasswordPolicy } from './auth-security'
import { authDb as prisma, tenantDb } from './db'
import { jwtRefreshSecret, jwtSecret } from './env'
import { ApiError, invalidateUserSessionCache } from './session'

export type TokenPair = {
  accessToken: string
  refreshToken: string
  userId: string
  role: string
}

async function signPair(user: { id: string; email: string; role: string; tenantId: string }): Promise<TokenPair> {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  }
  const accessTtl = process.env.JWT_ACCESS_TTL ?? '15m'
  const refreshTtl = process.env.JWT_REFRESH_TTL ?? '7d'
  const accessSecret = new TextEncoder().encode(jwtSecret())
  const refreshSecret = new TextEncoder().encode(jwtRefreshSecret())

  const [accessToken, refreshToken] = await Promise.all([
    new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(accessTtl)
      .sign(accessSecret),
    new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(refreshTtl)
      .sign(refreshSecret),
  ])

  const refreshTokenHash = await bcrypt.hash(refreshToken, 10)
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash },
  })

  return { accessToken, refreshToken, userId: user.id, role: user.role }
}

export async function loginUser(email: string, password: string): Promise<TokenPair> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), isActive: true },
  })
  if (!user) throw new Error('Invalid credentials')
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw new Error('Invalid credentials')
  // Only block accounts that were sent a verification link (new signups). Existing users
  // without emailVerifiedAt are grandfathered until they change email.
  if (!user.emailVerifiedAt && user.emailVerificationTokenHash) {
    throw new ApiError(403, 'Please verify your email before signing in. Check your inbox or request a new link.')
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })
  return signPair(user)
}

export async function registerUser(input: {
  tenantId: string
  email: string
  password: string
  firstName: string
  lastName: string
  role?: string
  /** Invite accept and admin-created users skip the verification gate. */
  emailVerified?: boolean
  issueTokens?: boolean
}): Promise<TokenPair | { userId: string; email: string; requiresVerification: true }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId } })
  if (!tenant) throw new Error('Tenant does not exist')
  const email = input.email.trim().toLowerCase()
  const existing = await prisma.user.findFirst({
    where: { tenantId: input.tenantId, email },
  })
  if (existing) throw new Error('Email already registered for this tenant')
  assertPasswordPolicy(input.password)
  const passwordHash = await bcrypt.hash(input.password, 12)
  const user = await prisma.user.create({
    data: {
      tenantId: input.tenantId,
      email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: (input.role ?? 'STAFF') as 'STAFF',
      permissions: [],
      ...(input.emailVerified ? { emailVerifiedAt: new Date() } : {}),
    },
  })

  if (input.issueTokens === false || !input.emailVerified) {
    if (!input.emailVerified) await sendEmailVerification(user.id)
    return { userId: user.id, email: user.email, requiresVerification: true as const }
  }
  return signPair(user)
}

export async function refreshUserTokens(userId: string, refreshToken: string): Promise<TokenPair> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user?.refreshTokenHash) throw new Error('Access denied')
  const ok = await bcrypt.compare(refreshToken, user.refreshTokenHash)
  if (!ok) throw new Error('Access denied')
  return signPair(user)
}

export async function logoutUser(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { refreshTokenHash: null },
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Joining a team requires a valid, unexpired invite token issued by a tenant admin. */
export async function acceptInvite(input: {
  token: string
  password: string
  firstName: string
  lastName: string
}): Promise<TokenPair & { tenantId: string }> {
  const invite = await tenantDb.tenantInvite.findUnique({ where: { token: input.token } })
  if (!invite || invite.revokedAt || invite.acceptedAt) {
    throw new ApiError(400, 'Invite is invalid or has already been used')
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, 'Invite has expired')
  }

  const result = await registerUser({
    tenantId: invite.tenantId,
    email: invite.email,
    password: input.password,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    role: invite.role,
    emailVerified: true,
    issueTokens: true,
  })
  if ('requiresVerification' in result) {
    throw new ApiError(500, 'Invite accept failed unexpectedly')
  }

  await tenantDb.tenantInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date() },
  })

  return { ...result, tenantId: invite.tenantId }
}

export async function sendEmailVerification(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || user.emailVerifiedAt) return

  const token = randomBytes(32).toString('hex')
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailVerificationTokenHash: sha256(token),
      emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  })

  const verifyUrl = `${process.env.APP_URL?.trim() || 'http://localhost:4000'}/verify-email?token=${token}`
  try {
    const { deliverNotification } = await import('./notification-provider')
    await deliverNotification({
      tenantId: user.tenantId,
      channel: 'EMAIL',
      recipient: user.email,
      templateKey: 'auth.email_verify',
      payload: { verifyUrl, firstName: user.firstName },
    })
  } catch (err) {
    console.error('[auth] failed to deliver verification email:', err)
  }
}

export async function verifyEmail(token: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { emailVerificationTokenHash: sha256(token), emailVerificationExpiresAt: { gt: new Date() } },
  })
  if (!user) throw new ApiError(400, 'Verification link is invalid or has expired')

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationTokenHash: null,
      emailVerificationExpiresAt: null,
    },
  })
}

export async function resendEmailVerification(email: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase(), isActive: true, emailVerifiedAt: null },
  })
  if (!user) return
  await sendEmailVerification(user.id)
}

/** Reveals nothing about whether the email exists; delivery happens out of band. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase(), isActive: true } })
  if (!user) return

  const token = randomBytes(32).toString('hex')
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: sha256(token),
      passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  })

  const appUrl = process.env.APP_URL?.trim() || 'http://localhost:5173'
  const resetUrl = `${appUrl}/reset-password?token=${token}`
  try {
    const { deliverNotification } = await import('./notification-provider')
    await deliverNotification({
      tenantId: user.tenantId,
      channel: 'EMAIL',
      recipient: user.email,
      templateKey: 'auth.password_reset',
      payload: { resetUrl, firstName: user.firstName },
    })
  } catch (err) {
    console.error('[auth] failed to deliver password reset email:', err)
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  assertPasswordPolicy(newPassword)
  const user = await prisma.user.findFirst({
    where: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: { gt: new Date() } },
  })
  if (!user) throw new ApiError(400, 'Reset link is invalid or has expired')

  const passwordHash = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
      // Invalidate existing sessions on password change.
      refreshTokenHash: null,
    },
  })
  invalidateUserSessionCache(user.id)
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new ApiError(404, 'User not found')
  const ok = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!ok) throw new ApiError(401, 'Current password is incorrect')
  assertPasswordPolicy(newPassword)
  const passwordHash = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, refreshTokenHash: null },
  })
}
