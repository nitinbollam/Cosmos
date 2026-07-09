import { randomUUID } from 'node:crypto'
import { authDb, tenantDb } from './db'
import { registerUser } from './auth'
import { ApiError } from './session'

export async function publicSignup(dto: {
  companyName: string
  slug: string
  email: string
  password: string
  firstName: string
  lastName: string
}) {
  const slug = dto.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  if (!slug || slug.length < 3) throw new ApiError(400, 'slug must be at least 3 characters')

  const existingSlug = await tenantDb.tenantOrganization.findUnique({ where: { slug } })
  if (existingSlug) throw new ApiError(409, 'Organization slug already taken')

  const existingEmail = await authDb.user.findFirst({ where: { email: dto.email.trim().toLowerCase() } })
  if (existingEmail) throw new ApiError(409, 'Email already registered')

  const tenantId = randomUUID()
  await authDb.tenant.create({
    data: { id: tenantId, name: dto.companyName.trim(), slug, isActive: true, settings: {} },
  })
  await tenantDb.tenantOrganization.create({
    data: {
      id: tenantId,
      slug,
      displayName: dto.companyName.trim(),
      plan: 'STARTER',
      onboardingPhase: 'PROFILE',
      settings: { salesTaxRate: 0.07, features: {} },
      billingEmail: dto.email.trim().toLowerCase(),
      metadata: {},
    },
  })

  const { seedOnboardingSteps } = await import('./tenant')
  await seedOnboardingSteps(tenantId)

  const result = await registerUser({
    tenantId,
    email: dto.email.trim().toLowerCase(),
    password: dto.password,
    firstName: dto.firstName.trim(),
    lastName: dto.lastName.trim(),
    role: 'TENANT_ADMIN',
    emailVerified: false,
    issueTokens: false,
  })

  const { ensureTier5Accounts } = await import('./operations-gl')
  await ensureTier5Accounts(tenantId).catch(() => undefined)

  if ('requiresVerification' in result) {
    return {
      tenantId,
      slug,
      requiresVerification: result.delivery !== 'auto',
      autoVerified: result.delivery === 'auto',
      email: result.email,
      verifyUrl: result.verifyUrl,
      delivery: result.delivery,
    }
  }
  return { tenantId, slug, ...result }
}
