import { IsBoolean } from 'class-validator'

export class SuspendTenantDto {
  @IsBoolean()
  suspended!: boolean
}
