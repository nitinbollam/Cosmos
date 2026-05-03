import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name!: string

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
}
