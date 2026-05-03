import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  companyName!: string

  @IsOptional()
  @IsEmail()
  email?: string
}
