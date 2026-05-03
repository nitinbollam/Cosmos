import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Roles, RolesGuard, TenantId } from '@cosmos/auth-middleware'
import { PosService } from './pos.service'
import { CreateRegisterDto } from './dto/create-register.dto'
import { OpenShiftDto } from './dto/open-shift.dto'
import { CloseShiftDto } from './dto/close-shift.dto'
import { CreateSaleDto } from './dto/create-sale.dto'
import { VoidSaleDto } from './dto/void-sale.dto'

@Controller()
@UseGuards(RolesGuard)
export class PosController {
  constructor(private readonly pos: PosService) {}

  @Get('registers')
  registers(@TenantId() tenantId: string) {
    return this.pos.listRegisters(tenantId)
  }

  @Roles('TENANT_ADMIN', 'SUPER_ADMIN')
  @Post('registers')
  createRegister(@TenantId() tenantId: string, @Body() dto: CreateRegisterDto) {
    return this.pos.createRegister(tenantId, dto)
  }

  @Post('shifts/open')
  openShift(@TenantId() tenantId: string, @Body() dto: OpenShiftDto) {
    return this.pos.openShift(tenantId, dto)
  }

  @Post('shifts/:id/close')
  closeShift(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.pos.closeShift(tenantId, id, dto)
  }

  @Get('sales')
  listSales(@TenantId() tenantId: string, @Query('shiftId') shiftId?: string) {
    return this.pos.listSales(tenantId, shiftId)
  }

  @Post('sales')
  createSale(@TenantId() tenantId: string, @Body() dto: CreateSaleDto) {
    return this.pos.createSale(tenantId, dto)
  }

  @Post('sales/:id/void')
  voidSale(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: VoidSaleDto) {
    return this.pos.voidSale(tenantId, id, dto)
  }
}
