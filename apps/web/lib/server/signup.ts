import { randomUUID } from 'node:crypto'
import { authDb, tenantDb } from './db'
import { registerUser } from './auth'
import { ApiError } from './session'

export function normalizeTenantSlug(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
  if (!slug || slug.length < 3) throw new ApiError(400, 'slug must be at least 3 characters')
  return slug
}

/**
 * Create a company (tenant) in both the auth and tenant databases, with onboarding steps.
 * Shared by public signup and the ops user-management tool.
 */
export async function createTenantOrganization(input: {
  companyName: string
  slug: string
  billingEmail: string
}): Promise<{ tenantId: string; slug: string }> {
  const slug = normalizeTenantSlug(input.slug)
  const companyName = input.companyName.trim()
  if (!companyName) throw new ApiError(400, 'Company name is required')

  const existingSlug = await tenantDb.tenantOrganization.findUnique({ where: { slug } })
  if (existingSlug) throw new ApiError(409, 'Organization slug already taken')

  const tenantId = randomUUID()
  await authDb.tenant.create({
    data: { id: tenantId, name: companyName, slug, isActive: true, settings: {} },
  })
  await tenantDb.tenantOrganization.create({
    data: {
      id: tenantId,
      slug,
      displayName: companyName,
      plan: 'STARTER',
      onboardingPhase: 'PROFILE',
      settings: { salesTaxRate: 0.07, features: {} },
      billingEmail: input.billingEmail.trim().toLowerCase(),
      metadata: {},
    },
  })

  const { seedOnboardingSteps } = await import('./tenant')
  await seedOnboardingSteps(tenantId)

  const { ensureTier5Accounts } = await import('./operations-gl')
  await ensureTier5Accounts(tenantId).catch(() => undefined)

  return { tenantId, slug }
}

export async function publicSignup(dto: {
  companyName: string
  slug: string
  email: string
  password: string
  firstName: string
  lastName: string
}) {
  const slug = normalizeTenantSlug(dto.slug)
  const existingSlug = await tenantDb.tenantOrganization.findUnique({ where: { slug } })
  if (existingSlug) throw new ApiError(409, 'Organization slug already taken')

  const existingEmail = await authDb.user.findFirst({ where: { email: dto.email.trim().toLowerCase() } })
  if (existingEmail) throw new ApiError(409, 'Email already registered')

  const { tenantId } = await createTenantOrganization({
    companyName: dto.companyName,
    slug,
    billingEmail: dto.email,
  })

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

  if ('requiresVerification' in result) {
    return {
      tenantId,
      slug,
      requiresVerification: true,
      email: result.email,
      verifyUrl: result.verifyUrl,
      delivery: result.delivery,
    }
  }
  return { tenantId, slug, ...result }
}
