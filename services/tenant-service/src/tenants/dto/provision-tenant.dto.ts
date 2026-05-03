import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

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
}
