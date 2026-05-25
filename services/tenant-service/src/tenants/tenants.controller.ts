import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { Roles, TenantId, RolesGuard } from '@cosmos/auth-middleware'
import { TenantsService } from './tenants.service'
import { PatchTenantDto } from './dto/patch-tenant.dto'
import { UpdatePlanDto } from './dto/update-plan.dto'
import { ProvisionTenantDto } from './dto/provision-tenant.dto'
import { PatchOnboardingStepDto } from './dto/patch-onboarding.dto'
import { SuspendTenantDto } from './dto/suspend.dto'
import { CreateInviteDto } from './dto/create-invite.dto'

@UseGuards(RolesGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Roles('SUPER_ADMIN')
  @Post()
  provision(@Body() dto: ProvisionTenantDto) {
    return this.tenants.provision(dto)
  }

  /** Current tenant derived from JWT (all tenant-scoped admins). */
  @Get('me')
  async me(@TenantId() tenantId: string) {
    return this.tenants.findByTenant(tenantId)
  }

  @Patch('me')
  async patchMe(@TenantId() tenantId: string, @Body() dto: PatchTenantDto) {
    return this.tenants.patchTenant(tenantId, {
      ...dto,
      settingsPatch: dto.settingsPatch as Record<string, unknown> | undefined,
      metadataPatch: dto.metadataPatch as Record<string, unknown> | undefined,
    })
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Get('me/invites')
  listInvites(@TenantId() tenantId: string) {
    return this.tenants.listPendingInvites(tenantId)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('me/invites')
  createInvite(@TenantId() tenantId: string, @Body() dto: CreateInviteDto) {
    return this.tenants.createInvite(tenantId, { email: dto.email, role: dto.role })
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Delete('me/invites/:id')
  revokeInvite(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.tenants.revokeInvite(tenantId, id)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('me/upgrade')
  upgrade(@TenantId() tenantId: string, @Body() dto: UpdatePlanDto) {
    return this.tenants.updatePlan(tenantId, dto.plan)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Patch('me/plan')
  async changePlan(@TenantId() tenantId: string, @Body() dto: UpdatePlanDto) {
    return this.tenants.updatePlan(tenantId, dto.plan)
  }

  @Roles('SUPER_ADMIN')
  @Patch(':tenantId/plan')
  adminChangePlan(@Param('tenantId') tenantId: string, @Body() dto: UpdatePlanDto) {
    return this.tenants.updatePlan(tenantId, dto.plan)
  }

  @Roles('SUPER_ADMIN')
  @Patch(':tenantId/suspend')
  suspend(@Param('tenantId') tenantId: string, @Body() body: SuspendTenantDto) {
    return this.tenants.suspend(tenantId, body.suspended)
  }

  @Patch('me/onboarding-steps/:stepKey')
  patchMyStep(@TenantId() tenantId: string, @Param('stepKey') stepKey: string, @Body() dto: PatchOnboardingStepDto) {
    return this.tenants.patchStep(tenantId, stepKey, dto)
  }

  /** Cross-tenant onboarding support for platform ops. */
  @Roles('SUPER_ADMIN')
  @Patch(':tenantId/onboarding-steps/:stepKey')
  adminPatchStep(
    @Param('tenantId') tenantId: string,
    @Param('stepKey') stepKey: string,
    @Body() dto: PatchOnboardingStepDto,
  ) {
    return this.tenants.patchStep(tenantId, stepKey, dto)
  }
}
