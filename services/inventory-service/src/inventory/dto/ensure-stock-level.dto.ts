import { IsInt, IsOptional, IsString } from 'class-validator'

export class EnsureStockLevelDto {
  @IsString() skuId!: string
  @IsString() warehouseId!: string
  @IsOptional() @IsString() locationId?: string
  @IsOptional() @IsInt() reorderPoint?: number
  @IsOptional() @IsInt() reorderQty?: number
}
