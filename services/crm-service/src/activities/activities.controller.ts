import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { TenantId } from '@cosmos/auth-middleware'
import { ActivitiesService } from './activities.service'
import { CreateActivityDto } from './dto/create-activity.dto'

@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  list(
    @TenantId() tenantId: string,
    @Query('customerId') customerId?: string,
    @Query('leadId') leadId?: string,
  ) {
    return this.activities.list(tenantId, customerId, leadId)
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.activities.get(tenantId, id)
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateActivityDto) {
    return this.activities.create(tenantId, dto)
  }
}
