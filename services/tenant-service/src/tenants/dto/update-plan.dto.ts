import { IsIn } from 'class-validator'

export class UpdatePlanDto {
  @IsIn(['STARTER', 'GROWTH', 'ENTERPRISE'])
  plan!: 'STARTER' | 'GROWTH' | 'ENTERPRISE'
}
