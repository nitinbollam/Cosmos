import bcrypt from 'bcrypt'
import * as jose from 'jose'
import { authDb as prisma } from './db'
import { jwtRefreshSecret, jwtSecret } from './env'

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
    where: { email, isActive: true },
  })
  if (!user) throw new Error('Invalid credentials')
  const ok = await bcrypt.compare(password, user.passwordHash)
  if (!ok) throw new Error('Invalid credentials')
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
}): Promise<TokenPair> {
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId } })
  if (!tenant) throw new Error('Tenant does not exist')
  const existing = await prisma.user.findFirst({
    where: { tenantId: input.tenantId, email: input.email },
  })
  if (existing) throw new Error('Email already registered for this tenant')
  const passwordHash = await bcrypt.hash(input.password, 12)
  const user = await prisma.user.create({
    data: {
      tenantId: input.tenantId,
      email: input.email,
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: (input.role ?? 'STAFF') as 'STAFF',
      permissions: [],
    },
  })
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
