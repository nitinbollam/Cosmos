import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator'

export class OrderLineItemDto {
  @IsString() skuId!: string
  @IsString() warehouseId!: string
  @IsNumber() @IsPositive() quantity!: number
  @IsNumber() unitPrice!: number
}

export class CreateOrderDto {
  @IsString() customerId!: string
  @IsIn(['POS', 'B2B_PORTAL', 'SALES_REP', 'API']) channel!: 'POS' | 'B2B_PORTAL' | 'SALES_REP' | 'API'
  @IsIn(['CARD', 'ACH', 'CHECK', 'CASH', 'NET_TERMS']) paymentMethod!:
    | 'CARD' | 'ACH' | 'CHECK' | 'CASH' | 'NET_TERMS'
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => OrderLineItemDto)
  lineItems!: OrderLineItemDto[]
  @IsOptional() @IsString() salesRepId?: string
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  @IsOptional() @IsString() notes?: string
}
