import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator'

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string

  @IsOptional()
  @IsString()
  lastName?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

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
