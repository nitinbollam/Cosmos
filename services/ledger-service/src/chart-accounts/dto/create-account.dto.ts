import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { AccountType } from '../../generated/prisma-client'

export class CreateChartAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name!: string

  @IsEnum(AccountType)
  type!: AccountType

  @IsOptional()
  isActive?: boolean
}
