import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

const INDUSTRIES = ['TOBACCO_VAPE', 'PHARMA', 'FOOD_BEVERAGE', 'ALCOHOL', 'GENERAL_WHOLESALE'] as const
export type IndustryVertical = (typeof INDUSTRIES)[number]

export class ProvisionTenantDto {
  @IsString()
  @MaxLength(64)
  id!: string

  @IsString()
  @MaxLength(120)
  slug!: string

  @IsString()
  @MaxLength(240)
  displayName!: string

  @IsOptional()
  @IsIn(['STARTER', 'GROWTH', 'ENTERPRISE'])
  plan?: 'STARTER' | 'GROWTH' | 'ENTERPRISE'

  @IsOptional()
  @IsIn(INDUSTRIES)
  industry?: IndustryVertical
}
