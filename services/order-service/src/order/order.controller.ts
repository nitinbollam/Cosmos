import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { OrderService } from './order.service'
import { OrderSaga } from './order.saga'
import { CreateOrderDto } from './dto/create-order.dto'

@Controller('orders')
export class OrderController {
  constructor(
    private orders: OrderService,
    private saga: OrderSaga,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: { user: { tenantId: string } }, @Body() dto: CreateOrderDto) {
    const { order, correlationId } = await this.orders.create(req.user.tenantId, dto)
    // Fire saga without blocking request — best-effort. Production should
    // enqueue this onto BullMQ; tracked in MISSING.md.
    this.saga
      .execute(order.id, req.user.tenantId, correlationId)
      .catch(() => {
        /* saga handles its own state + error logging */
      })
    return order
  }

  @Get()
  list(
    @Req() req: { user: { tenantId: string } },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('search') search?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('customerId') customerId?: string,
  ) {
    const term = (search ?? q)?.trim() || undefined
    return this.orders.list(req.user.tenantId, page ? +page : 1, pageSize ? +pageSize : 20, {
      status: status?.trim() || undefined,
      channel: channel?.trim() || undefined,
      search: term,
      fromIso: from?.trim() || undefined,
      toIso: to?.trim() || undefined,
      customerId: customerId?.trim() || undefined,
    })
  }

  @Post(':id/confirm')
  confirm(@Req() req: { user: { tenantId: string } }, @Param('id') id: string) {
    return this.orders.confirm(req.user.tenantId, id)
  }

  @Get(':id')
  get(@Req() req: { user: { tenantId: string } }, @Param('id') id: string) {
    return this.orders.findById(req.user.tenantId, id)
  }

  @Post(':id/cancel')
  cancel(
    @Req() req: { user: { tenantId: string } },
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    if (!body?.reason) throw new BadRequestException('reason is required')
    return this.orders.cancel(req.user.tenantId, id, body.reason)
  }
}
