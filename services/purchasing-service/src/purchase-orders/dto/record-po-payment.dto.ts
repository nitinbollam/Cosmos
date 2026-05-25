import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator'

export class RecordPoPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number

  @IsIn(['CASH', 'CHECK', 'ACH', 'CARD'])
  method!: 'CASH' | 'CHECK' | 'ACH' | 'CARD'

  @IsOptional()
  @IsString()
  reference?: string
}
