import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'

export class RegisterDto {
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
    'SUPER_ADMIN',
    'TENANT_ADMIN',
    'MANAGER',
    'WAREHOUSE_STAFF',
    'SALES_REP',
    'DRIVER',
    'ACCOUNTANT',
    'VIEWER',
    'STAFF',
  ])
  role?:
    | 'SUPER_ADMIN'
    | 'TENANT_ADMIN'
    | 'MANAGER'
    | 'WAREHOUSE_STAFF'
    | 'SALES_REP'
    | 'DRIVER'
    | 'ACCOUNTANT'
    | 'VIEWER'
    | 'STAFF'
}
