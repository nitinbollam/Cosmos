import { Type } from 'class-transformer'
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator'

export class CycleLineImportRowDto {
  @IsOptional()
  @IsString()
  skuId?: string

  @IsOptional()
  @IsString()
  skuCode?: string

  @IsOptional()
  @IsString()
  locationLabel?: string

  @Type(() => Number)
  @IsInt()
  @Min(0)
  countedQty!: number
}

export class ImportCycleLinesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CycleLineImportRowDto)
  rows!: CycleLineImportRowDto[]
}
