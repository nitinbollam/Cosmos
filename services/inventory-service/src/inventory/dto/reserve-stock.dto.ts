import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator'

export class ReserveStockDto {
  @IsString() skuId!: string
  @IsString() warehouseId!: string
  @IsOptional() @IsString() batchId?: string
  @IsString() orderId!: string
  @IsInt() @IsPositive() quantity!: number
  @IsString() correlationId!: string
}

export class ReleaseReservationDto {
  @IsString() reservationId!: string
  @IsString() correlationId!: string
}
