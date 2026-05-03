import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator'

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
  @IsObject()
  settingsPatch?: Record<string, unknown>

  @IsOptional()
  @IsObject()
  metadataPatch?: Record<string, unknown>
}
