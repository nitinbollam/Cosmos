import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class MsaTransactionImportRowDto {
  @IsString()
  @MinLength(1)
  manufacturerDid!: string

  @IsString()
  @MinLength(1)
  upcCode!: string

  @IsDateString()
  transactionDate!: string

  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantityPurchased!: number

  @Type(() => Number)
  @IsInt()
  @Min(0)
  cartonCount!: number

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  netAmount!: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  returnAmount?: number

  @IsOptional()
  @IsBoolean()
  isQualifying?: boolean

  @IsOptional()
  @IsString()
  orderId?: string

  @IsOptional()
  @IsString()
  poId?: string
}

export class ImportMsaTransactionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MsaTransactionImportRowDto)
  rows!: MsaTransactionImportRowDto[]
}
