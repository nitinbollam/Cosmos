import { IsIn, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator'

export class AuthorizeDto {
  @IsString() orderId!: string
  @IsNumber() @IsPositive() amount!: number
  @IsString() currency!: string
  @IsIn(['CARD', 'ACH', 'CHECK', 'CASH', 'NET_TERMS']) paymentMethod!: 'CARD' | 'ACH' | 'CHECK' | 'CASH' | 'NET_TERMS'
  @IsString() customerId!: string
  @IsOptional() @IsString() paymentMethodId?: string
  @IsString() correlationId!: string
}

export class CaptureDto {
  @IsString() paymentIntentId!: string
  @IsString() correlationId!: string
}

export class VoidDto {
  @IsString() paymentIntentId!: string
  @IsString() correlationId!: string
}

export class RefundDto {
  @IsString() paymentIntentId!: string
  @IsOptional() @IsNumber() @IsPositive() amount?: number
  @IsString() correlationId!: string
}
