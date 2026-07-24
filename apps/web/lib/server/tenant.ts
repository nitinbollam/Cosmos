import { randomBytes } from 'node:crypto'
import type { Prisma } from '@/generated/prisma-tenant'
import { OnboardingPhase } from '@/generated/prisma-tenant'
import { tenantDb } from './db'
import { ApiError } from './session'

const DEFAULT_STEP_KEYS = ['ORG_PROFILE', 'BILLING_CONTACT', 'FIRST_WAREHOUSE', 'COMPLIANCE_ACK'] as const

function deepMerge(target: Prisma.JsonObject, patch?: Record<string, unknown>): Prisma.JsonObject {
  if (!patch || typeof patch !== 'object') return target
  const out: Prisma.JsonObject = { ...target }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    const cur = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = deepMerge(cur as Prisma.JsonObject, v as Record<string, unknown>)
    } else {
      out[k] = v as Prisma.JsonValue
    }
  }
  return out
}

async function ensureExists(id: string) {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id } })
  if (!org) throw new ApiError(404, 'Tenant organization not found')
  return org
}

export async function findTenantById(tenantId: string) {
  const org = await tenantDb.tenantOrganization.findUnique({ where: { id: tenantId } })
  if (!org) throw new ApiError(404, 'Tenant organization not found')
  const steps = await tenantDb.tenantOnboardingStep.findMany({
    where: { tenantId },
    orderBy: { stepKey: 'asc' },
  })
  return { ...org, onboardingSteps: steps }
}

export async function patchTenant(
  tenantId: string,
  patch: {
    displayName?: string
    billingEmail?: string | null
    timeZone?: string
    industry?: string
    settingsPatch?: Record<string, unknown>
    metadataPatch?: Record<string, unknown>
  },
) {
  const org = await ensureExists(tenantId)
  let settingsNext: Prisma.JsonObject | undefined
  if (patch.settingsPatch) {
    const base = ((org.settings as Prisma.JsonObject) ?? {}) as Prisma.JsonObject
    const { features, ...rest } = patch.settingsPatch
    settingsNext = deepMerge(base, rest)
    if (features !== undefined) {
      settingsNext = { ...settingsNext, features: features as Prisma.JsonValue }
    }
  }
  const metadataNext = patch.metadataPatch
    ? deepMerge((org.metadata as Prisma.JsonObject) ?? {}, patch.metadataPatch)
    : undefined
  return tenantDb.tenantOrganization.update({
    where: { id: tenantId },
    data: {
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.billingEmail !== undefined ? { billingEmail: patch.billingEmail ?? null } : {}),
      ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
      ...(patch.industry !== undefined ? { industry: patch.industry as never } : {}),
      ...(settingsNext !== undefined ? { settings: settingsNext } : {}),
      ...(metadataNext !== undefined ? { metadata: metadataNext } : {}),
    },
  })
}

export async function updateTenantPlan(tenantId: string, plan: 'STARTER' | 'GROWTH' | 'ENTERPRISE') {
  const { devUpdateTenantPlan } = await import('./billing')
  return devUpdateTenantPlan(tenantId, plan)
}

/** Create default onboarding checklist rows for a brand-new tenant. */
export async function seedOnboardingSteps(tenantId: string) {
  await ensureExists(tenantId)
  for (const stepKey of DEFAULT_STEP_KEYS) {
    await tenantDb.tenantOnboardingStep.upsert({
      where: { tenantId_stepKey: { tenantId, stepKey } },
      update: {},
      create: { tenantId, stepKey, completed: false, payload: {} },
    })
  }
}

export async function patchOnboardingStep(
  tenantId: string,
  stepKey: string,
  body: { completed?: boolean; payload?: Record<string, unknown> },
) {
  await ensureExists(tenantId)
  const existing = await tenantDb.tenantOnboardingStep.findUnique({
    where: { tenantId_stepKey: { tenantId, stepKey } },
  })
  if (!existing) throw new ApiError(400, `Unknown onboarding step '${stepKey}'`)

  const next = await tenantDb.tenantOnboardingStep.update({
    where: { tenantId_stepKey: { tenantId, stepKey } },
    data: {
      ...(body.completed !== undefined
        ? { completed: body.completed, completedAt: body.completed ? new Date() : null }
        : {}),
      ...(body.payload !== undefined ? { payload: body.payload as Prisma.InputJsonValue } : {}),
    },
  })

  const allSteps = await tenantDb.tenantOnboardingStep.findMany({ where: { tenantId } })
  const allDone = DEFAULT_STEP_KEYS.every((k) => allSteps.some((s) => s.stepKey === k && s.completed))
  if (allDone) {
    await tenantDb.tenantOrganization.update({
      where: { id: tenantId },
      data: { onboardingPhase: OnboardingPhase.READY },
    })
  }
  return next
}

export async function listPendingInvites(tenantId: string) {
  await ensureExists(tenantId)
  const rows = await tenantDb.tenantInvite.findMany({
    where: { tenantId, revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  // Never expose the raw token after creation.
  return rows.map(({ token: _token, ...rest }) => rest)
}

export async function createInvite(tenantId: string, input: { email: string; role?: string }) {
  const org = await ensureExists(tenantId)
  const email = input.email.trim().toLowerCase()
  const pending = await tenantDb.tenantInvite.findFirst({
    where: { tenantId, email, revokedAt: null, acceptedAt: null, expiresAt: { gt: new Date() } },
  })
  if (pending) throw new ApiError(409, 'An invite is already pending for this email')

  const token = randomBytes(32).toString('hex')
  const row = await tenantDb.tenantInvite.create({
    data: {
      tenantId,
      email,
      role: input.role ?? 'STAFF',
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  const appUrl = process.env.APP_URL?.trim() || 'http://localhost:5173'
  const inviteUrl = `${appUrl}/accept-invite?token=${token}`
  try {
    const { deliverNotification } = await import('./notification-provider')
    await deliverNotification({
      tenantId,
      channel: 'EMAIL',
      recipient: email,
      templateKey: 'tenant.invite',
      payload: { inviteUrl, role: row.role, orgName: org.displayName },
    })
  } catch (err) {
    console.error('[tenant] failed to deliver invite email:', err)
  }

  // Returned once so the admin can copy the link if email isn't configured.
  return { ...row, inviteUrl }
}

export async function revokeInvite(tenantId: string, inviteId: string) {
  await ensureExists(tenantId)
  const row = await tenantDb.tenantInvite.findFirst({ where: { id: inviteId, tenantId } })
  if (!row) throw new ApiError(404, 'Invite not found')
  if (row.revokedAt) return row
  return tenantDb.tenantInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
  })
}
