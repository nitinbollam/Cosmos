import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

export class PatchCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name?: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalRef?: string

  @IsOptional()
  @IsIn(['BUSINESS', 'INDIVIDUAL'])
  customerKind?: 'BUSINESS' | 'INDIVIDUAL'

  @IsOptional()
  @IsString()
  @MaxLength(128)
  firstName?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  lastName?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxId?: string

  @IsOptional()
  @IsBoolean()
  isLicensedTobacco?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(128)
  tobaccoLicenseNumber?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditUsed?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  paymentTermsDays?: number

  @IsOptional()
  @IsString()
  salesRepUserId?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  primaryAddressLine1?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  primaryCity?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  primaryState?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  primaryZip?: string
}
