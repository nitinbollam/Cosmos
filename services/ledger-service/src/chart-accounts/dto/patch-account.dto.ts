import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class PatchChartAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
