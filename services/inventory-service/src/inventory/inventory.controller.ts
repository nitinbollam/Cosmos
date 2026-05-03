import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { InventoryService } from './inventory.service'
import { ReceiveStockDto } from './dto/receive-stock.dto'
import { ReserveStockDto, ReleaseReservationDto } from './dto/reserve-stock.dto'
import { AdjustStockDto } from './dto/adjust-stock.dto'
import { TransferStockDto } from './dto/transfer-stock.dto'

@Controller('inventory')
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  @Get('ledger')
  ledger(
    @Req() req: { user: { tenantId: string } },
    @Query('skuId') skuId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!skuId?.trim()) throw new BadRequestException('skuId query required')
    return this.inventory.ledgerForSku(req.user.tenantId, skuId.trim(), limit ? +limit : 100)
  }

  @Post('transfer')
  transfer(@Req() req: { user: { tenantId: string; userId: string } }, @Body() dto: TransferStockDto) {
    return this.inventory.transferStock(req.user.tenantId, dto, req.user.userId)
  }

  @Post('receive')
  receive(@Req() req: { user: { tenantId: string; userId: string } }, @Body() dto: ReceiveStockDto) {
    return this.inventory.receiveStock(req.user.tenantId, dto, req.user.userId)
  }

  @Post('adjust')
  adjust(@Req() req: { user: { tenantId: string; userId: string } }, @Body() dto: AdjustStockDto) {
    return this.inventory.adjustStock(req.user.tenantId, dto, req.user.userId)
  }

  @Post('stock/reserve')
  async reserve(@Req() req: { user: { tenantId: string } }, @Body() dto: ReserveStockDto) {
    const reservationId = await this.inventory.reserveStock(req.user.tenantId, dto)
    return { reservationId }
  }

  @Post('stock/release')
  async release(@Req() req: { user: { tenantId: string } }, @Body() dto: ReleaseReservationDto) {
    await this.inventory.releaseReservation(req.user.tenantId, dto.reservationId, dto.correlationId)
    return { released: true }
  }

  @Post('stock/fulfill/:reservationId')
  async fulfill(
    @Req() req: { user: { tenantId: string } },
    @Param('reservationId') reservationId: string,
    @Body() body: { correlationId: string },
  ) {
    await this.inventory.fulfillReservation(req.user.tenantId, reservationId, body.correlationId)
    return { fulfilled: true }
  }

  @Get('alerts')
  alerts(@Req() req: { user: { tenantId: string } }) {
    return this.inventory.lowStockAlerts(req.user.tenantId)
  }

  @Get('levels')
  levels(
    @Req() req: { user: { tenantId: string } },
    @Query('skuId') skuId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.inventory.getStockLevels(req.user.tenantId, { skuId, warehouseId })
  }
}
