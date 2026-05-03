import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator'

export class TransferStockDto {
  @IsString() skuId!: string
  @IsString() fromWarehouseId!: string
  @IsString() toWarehouseId!: string
  @IsOptional() @IsString() batchId?: string
  @IsInt() @IsPositive() quantity!: number
}
