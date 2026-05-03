import { IsInt, IsOptional, IsString } from 'class-validator'

export class AdjustStockDto {
  @IsString() skuId!: string
  @IsString() warehouseId!: string
  @IsOptional() @IsString() batchId?: string
  @IsInt() quantityDelta!: number
  @IsString() reason!: string
}
