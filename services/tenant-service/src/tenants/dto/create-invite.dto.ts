import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator'

const INVITE_ROLES = [
  'TENANT_ADMIN',
  'MANAGER',
  'WAREHOUSE_STAFF',
  'SALES_REP',
  'DRIVER',
  'ACCOUNTANT',
  'VIEWER',
  'STAFF',
] as const

export class CreateInviteDto {
  @IsEmail()
  email!: string

  @IsOptional()
  @IsString()
  @IsIn([...INVITE_ROLES])
  role?: (typeof INVITE_ROLES)[number]
}
