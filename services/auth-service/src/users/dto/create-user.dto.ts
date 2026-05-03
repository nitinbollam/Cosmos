import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator'

export class CreateUserDto {
  @IsString()
  tenantId!: string

  @IsEmail()
  email!: string

  @IsString()
  @MinLength(8)
  password!: string

  @IsString()
  firstName!: string

  @IsString()
  lastName!: string

  @IsOptional()
  @IsIn([
    'TENANT_ADMIN',
    'MANAGER',
    'WAREHOUSE_STAFF',
    'SALES_REP',
    'DRIVER',
    'ACCOUNTANT',
    'VIEWER',
    'STAFF',
  ])
  role?: string
}
