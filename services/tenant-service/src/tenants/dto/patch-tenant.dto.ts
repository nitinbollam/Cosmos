import { IsEmail, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'

const INDUSTRIES = ['TOBACCO_VAPE', 'PHARMA', 'FOOD_BEVERAGE', 'ALCOHOL', 'GENERAL_WHOLESALE'] as const

export class PatchTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string

  @IsOptional()
  @IsEmail()
  billingEmail?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(120)
  timeZone?: string

  @IsOptional()
  @IsIn(INDUSTRIES)
  industry?: (typeof INDUSTRIES)[number]

  @IsOptional()
  @IsObject()
  settingsPatch?: Record<string, unknown>

  @IsOptional()
  @IsObject()
  metadataPatch?: Record<string, unknown>
}
