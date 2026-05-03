import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class QuoteLineInputDto {
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
  qty!: number

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number
}

export class CreateQuoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  customerRef!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineInputDto)
  lines!: QuoteLineInputDto[]
}
