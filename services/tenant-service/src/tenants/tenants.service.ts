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
