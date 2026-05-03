import { Body, Controller, Get, Headers, Post } from '@nestjs/common'
import { TenantId } from '@cosmos/auth-middleware'
import { NotificationsService } from './notifications.service'
import { SendNotificationDto } from './dto/send-notification.dto'

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.notifications.list(tenantId)
  }

  @Post('send')
  send(
    @TenantId() tenantId: string,
    @Body() dto: SendNotificationDto,
    @Headers('idempotency-key') idem?: string,
  ) {
    const key = idem?.trim() || undefined
    return this.notifications.send(tenantId, dto, key)
  }
}
