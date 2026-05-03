import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { SkuService, CreateSkuInput } from './sku.service'

@Controller('skus')
export class SkuController {
  constructor(private skus: SkuService) {}

  @Get('categories')
  categories(@Req() req: { user: { tenantId: string } }) {
    return this.skus.distinctCategories(req.user.tenantId)
  }

  @Get()
  list(
    @Req() req: { user: { tenantId: string } },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('inStock') inStock?: string,
  ) {
    const term = (search ?? q)?.trim() || undefined
    return this.skus.list(req.user.tenantId, page ? +page : 1, pageSize ? +pageSize : 50, term, {
      category: category?.trim() || undefined,
      warehouseId: warehouseId?.trim() || undefined,
      inStockOnly: inStock === 'true' || inStock === '1',
    })
  }

  /** Code or barcode — receiving / warehouse scans. Must stay above `:id`. */
  @Get('lookup/scan-value')
  lookupScanValue(
    @Req() req: { user: { tenantId: string } },
    @Query('value') value?: string,
  ) {
    if (!value?.trim()) throw new NotFoundException('value query required')
    return this.skus.findByScanValue(req.user.tenantId, value.trim())
  }

  /** Resolve SKU by immutable code (tenant-scoped). Must stay above `:id`. */
  @Get('lookup/by-code')
  lookupByCode(
    @Req() req: { user: { tenantId: string } },
    @Query('code') code?: string,
  ) {
    if (!code?.trim()) throw new NotFoundException('code query required')
    return this.skus.findByCode(req.user.tenantId, code.trim())
  }

  @Get(':id')
  get(@Req() req: { user: { tenantId: string } }, @Param('id') id: string) {
    return this.skus.findById(req.user.tenantId, id)
  }

  @Post()
  create(@Req() req: { user: { tenantId: string } }, @Body() body: CreateSkuInput) {
    return this.skus.create(req.user.tenantId, body)
  }

  @Patch(':id')
  patch(
    @Req() req: { user: { tenantId: string } },
    @Param('id') id: string,
    @Body() body: Partial<CreateSkuInput> & { isActive?: boolean },
  ) {
    return this.skus.update(req.user.tenantId, id, body)
  }
}
