import { Type } from 'class-transformer'
import { IsArray, IsNumber, IsOptional, IsString, Min, MinLength, ValidateNested } from 'class-validator'

export class SkuImportRowDto {
  @IsString()
  @MinLength(1)
  code!: string

  @IsString()
  @MinLength(1)
  name!: string

  @IsString()
  @MinLength(1)
  category!: string

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost!: number

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsString()
  subcategory?: string

  @IsOptional()
  @IsString()
  barcode?: string

  @IsOptional()
  @IsString()
  unitOfMeasure?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  reorderPoint?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  reorderQty?: number
}

export class ImportSkusDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SkuImportRowDto)
  rows!: SkuImportRowDto[]
}
