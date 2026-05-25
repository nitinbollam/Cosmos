import { Type } from 'class-transformer'
import { IsEmail, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  companyName!: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  contactName?: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pipelineValue?: number

  @IsOptional()
  @IsString()
  @MinLength(1)
  assignedToUserId?: string
}
