import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { ActivityType } from '../../generated/prisma-client'

export class CreateActivityDto {
  @IsEnum(ActivityType)
  type!: ActivityType

  @IsOptional()
  @IsString()
  @MaxLength(512)
  subject?: string

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  customerId?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  leadId?: string
}
