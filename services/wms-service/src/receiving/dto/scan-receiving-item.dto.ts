import { Type } from 'class-transformer'
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator'

export class ScanReceivingItemDto {
  @IsString()
  @MinLength(1)
  barcode!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  receivedQty!: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  damagedQty?: number

  @IsOptional()
  @IsString()
  batchId?: string

  @IsOptional()
  @IsDateString()
  expiryDate?: string

  @IsOptional()
  @IsString()
  locationId?: string
}
