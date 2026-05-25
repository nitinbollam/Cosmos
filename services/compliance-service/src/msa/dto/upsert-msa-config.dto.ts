import { IsBoolean, IsOptional, IsString } from 'class-validator'

export class UpsertMsaConfigDto {
  @IsString()
  reporterDid!: string

  @IsOptional()
  @IsBoolean()
  msaEnabled?: boolean

  @IsString()
  manufacturerDid!: string

  @IsString()
  manufacturerName!: string

  @IsOptional()
  @IsString()
  ediEndpoint?: string

  @IsOptional()
  @IsBoolean()
  autoSubmit?: boolean
}
