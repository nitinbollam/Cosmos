import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name?: string

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string
}
