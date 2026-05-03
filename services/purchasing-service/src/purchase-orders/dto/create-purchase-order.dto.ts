import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class CreatePurchaseOrderLineDto {
  @IsInt()
  @Min(1)
  lineNo!: number

  @IsOptional()
  @IsString()
  @MaxLength(128)
  skuCode?: string

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  description!: string

  @IsInt()
  @Min(1)
  qtyOrdered!: number
}

export class CreatePurchaseOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  supplierId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  number!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[]
}
