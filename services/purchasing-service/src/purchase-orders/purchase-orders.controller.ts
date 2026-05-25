import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { PurchaseOrderStatus } from '../generated/prisma-client'
import { PurchaseOrdersService } from './purchase-orders.service'
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto'
import { ReceiveGoodsDto } from './dto/receive-goods.dto'
import { RecordPoPaymentDto } from './dto/record-po-payment.dto'

@Controller('purchase-orders')
@UseGuards(RolesGuard)
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Get()
  list(@TenantId() tenantId: string, @Query('status') status?: PurchaseOrderStatus) {
    return this.orders.list(tenantId, status)
  }

  @Get(':id')
  get(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.get(tenantId, id)
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreatePurchaseOrderDto) {
    return this.orders.create(tenantId, dto)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post(':id/submit')
  submit(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.submit(tenantId, id)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post(':id/cancel')
  cancel(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.cancel(tenantId, id)
  }

  @Post(':id/receive')
  receive(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: ReceiveGoodsDto) {
    return this.orders.receiveGoods(tenantId, id, dto)
  }

  /** Partial/full supplier payment against PO line total (AP-style for finance UI). */
  @Post(':id/payments')
  recordPayment(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: RecordPoPaymentDto) {
    return this.orders.recordPayment(tenantId, id, {
      amount: dto.amount,
      method: dto.method,
      reference: dto.reference,
    })
  }
}
