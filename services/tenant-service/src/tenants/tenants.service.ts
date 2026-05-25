import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import type { Prisma } from '../generated/prisma-client'
import { OnboardingPhase } from '../generated/prisma-client'
import { PrismaService } from '../prisma/prisma.service'

export const DEFAULT_STEP_KEYS = ['ORG_PROFILE', 'BILLING_CONTACT', 'FIRST_WAREHOUSE', 'COMPLIANCE_ACK'] as const

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  private deepMerge(target: Prisma.JsonObject, patch?: Record<string, unknown>): Prisma.JsonObject {
    if (!patch || typeof patch !== 'object') return target
    const out: Prisma.JsonObject = { ...target }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue
      const cur = out[k]
      if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        cur &&
        typeof cur === 'object' &&
        !Array.isArray(cur)
      ) {
        out[k] = this.deepMerge(cur as Prisma.JsonObject, v as Record<string, unknown>)
      } else {
        out[k] = v as Prisma.JsonValue
      }
    }
    return out
  }

  async provision(input: {
    id: string
    slug: string
    displayName: string
    plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE'
    industry?: 'TOBACCO_VAPE' | 'PHARMA' | 'FOOD_BEVERAGE' | 'ALCOHOL' | 'GENERAL_WHOLESALE'
  }) {
    const existing = await this.prisma.tenantOrganization.findFirst({
      where: { OR: [{ id: input.id }, { slug: input.slug }] },
    })
    if (existing) {
      throw new ConflictException('Tenant id or slug already exists')
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.tenantOrganization.create({
        data: {
          id: input.id,
          slug: input.slug,
          displayName: input.displayName,
          plan: input.plan ?? 'STARTER',
          industry: input.industry ?? 'GENERAL_WHOLESALE',
          onboardingPhase: 'PROFILE',
          settings: {},
          metadata: {},
        },
      })
      await tx.tenantOnboardingStep.createMany({
        data: DEFAULT_STEP_KEYS.map((stepKey) => ({
          tenantId: org.id,
          stepKey,
          completed: false,
        })),
      })
      return org
    })
  }

  async findById(id: string) {
    return this.prisma.tenantOrganization.findUnique({ where: { id } })
  }

  async findByTenant(tenantId: string) {
    const org = await this.prisma.tenantOrganization.findUnique({ where: { id: tenantId } })
    if (!org) throw new NotFoundException('Tenant organization not found')
    const steps = await this.prisma.tenantOnboardingStep.findMany({
      where: { tenantId },
      orderBy: { stepKey: 'asc' },
    })
    return { ...org, onboardingSteps: steps }
  }

  async patchTenant(
    tenantId: string,
    patch: {
      displayName?: string
      billingEmail?: string | null
      timeZone?: string
      industry?: 'TOBACCO_VAPE' | 'PHARMA' | 'FOOD_BEVERAGE' | 'ALCOHOL' | 'GENERAL_WHOLESALE'
      settingsPatch?: Record<string, unknown>
      metadataPatch?: Record<string, unknown>
    },
  ) {
    const org = await this.prisma.tenantOrganization.findUnique({ where: { id: tenantId } })
    if (!org) throw new NotFoundException('Tenant organization not found')

    const settingsNext = patch.settingsPatch
      ? this.deepMerge((org.settings as Prisma.JsonObject) ?? {}, patch.settingsPatch)
      : undefined
    const metadataNext = patch.metadataPatch
      ? this.deepMerge((org.metadata as Prisma.JsonObject) ?? {}, patch.metadataPatch)
      : undefined

    return this.prisma.tenantOrganization.update({
      where: { id: tenantId },
      data: {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.billingEmail !== undefined ? { billingEmail: patch.billingEmail ?? null } : {}),
        ...(patch.timeZone !== undefined ? { timeZone: patch.timeZone } : {}),
        ...(patch.industry !== undefined ? { industry: patch.industry } : {}),
        ...(settingsNext !== undefined ? { settings: settingsNext } : {}),
        ...(metadataNext !== undefined ? { metadata: metadataNext } : {}),
      },
    })
  }

  async updatePlan(tenantId: string, plan: 'STARTER' | 'GROWTH' | 'ENTERPRISE') {
    await this.ensureExists(tenantId)
    return this.prisma.tenantOrganization.update({
      where: { id: tenantId },
      data: { plan },
    })
  }

  async suspend(tenantId: string, suspended: boolean) {
    await this.ensureExists(tenantId)
    return this.prisma.tenantOrganization.update({
      where: { id: tenantId },
      data: { suspended },
    })
  }

  async patchStep(tenantId: string, stepKey: string, body: { completed?: boolean; payload?: Record<string, unknown> }) {
    await this.ensureExists(tenantId)
    const existing = await this.prisma.tenantOnboardingStep.findUnique({
      where: { tenantId_stepKey: { tenantId, stepKey } },
    })
    if (!existing) throw new BadRequestException(`Unknown onboarding step '${stepKey}'`)

    const next = await this.prisma.tenantOnboardingStep.update({
      where: { tenantId_stepKey: { tenantId, stepKey } },
      data: {
        ...(body.completed !== undefined
          ? {
              completed: body.completed,
              completedAt: body.completed ? new Date() : null,
            }
          : {}),
        ...(body.payload !== undefined ? { payload: body.payload as Prisma.InputJsonValue } : {}),
      },
    })

    const allSteps = await this.prisma.tenantOnboardingStep.findMany({ where: { tenantId } })
    const allDone = DEFAULT_STEP_KEYS.every((k) => allSteps.some((s) => s.stepKey === k && s.completed))
    await this.maybeAdvancePhase(tenantId, allDone)

    return next
  }

  async listPendingInvites(tenantId: string) {
    await this.ensureExists(tenantId)
    return this.prisma.tenantInvite.findMany({
      where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createInvite(tenantId: string, input: { email: string; role?: string }) {
    await this.ensureExists(tenantId)
    const email = input.email.trim().toLowerCase()
    const pending = await this.prisma.tenantInvite.findFirst({
      where: { tenantId, email, revokedAt: null, expiresAt: { gt: new Date() } },
    })
    if (pending) throw new ConflictException('An invite is already pending for this email')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    return this.prisma.tenantInvite.create({
      data: {
        tenantId,
        email,
        role: input.role ?? 'STAFF',
        expiresAt,
      },
    })
  }

  async revokeInvite(tenantId: string, inviteId: string) {
    await this.ensureExists(tenantId)
    const row = await this.prisma.tenantInvite.findFirst({ where: { id: inviteId, tenantId } })
    if (!row) throw new NotFoundException('Invite not found')
    if (row.revokedAt) return row
    return this.prisma.tenantInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    })
  }

  private async ensureExists(id: string) {
    const org = await this.prisma.tenantOrganization.findUnique({ where: { id } })
    if (!org) throw new NotFoundException('Tenant organization not found')
    return org
  }

  private async maybeAdvancePhase(tenantId: string, allCoreDone: boolean) {
    if (!allCoreDone) return
    await this.prisma.tenantOrganization.update({
      where: { id: tenantId },
      data: { onboardingPhase: OnboardingPhase.READY },
    })
  }
}
