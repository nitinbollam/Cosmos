import { Type } from 'class-transformer'
import {
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class SaleLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  skuCode!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number
}

export class CreateSaleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  shiftId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  saleRef!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleLineDto)
  lines!: SaleLineDto[]

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total!: number
}
