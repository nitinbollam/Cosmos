import { Type } from 'class-transformer'
import { IsArray, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator'

export class ReceivingItemImportRowDto {
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
  @IsString()
  locationId?: string
}

export class ImportReceivingItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivingItemImportRowDto)
  rows!: ReceivingItemImportRowDto[]
}
