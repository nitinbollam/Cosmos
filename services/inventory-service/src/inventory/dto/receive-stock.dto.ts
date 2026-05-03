import { IsInt, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator'

export class ReceiveStockDto {
  @IsString() skuId!: string
  @IsString() warehouseId!: string
  @IsOptional() @IsString() locationId?: string
  @IsOptional() @IsString() batchId?: string
  @IsInt() @IsPositive() quantity!: number
  @IsNumber() unitCost!: number
  @IsString() supplierId!: string
  @IsOptional() @IsString() poId?: string
}
