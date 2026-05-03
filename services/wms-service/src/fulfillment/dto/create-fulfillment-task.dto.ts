import { Type } from 'class-transformer'
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
  IsInt,
  Min,
  IsNumber,
} from 'class-validator'

export class FulfillmentLineDto {
  @IsString() skuId!: string
  @IsString() warehouseId!: string
  @IsInt() @Min(1) quantity!: number
  @IsOptional() @IsNumber() unitPrice?: number
}

export class CreateFulfillmentTaskDto {
  @IsString() orderId!: string
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => FulfillmentLineDto)
  lineItems!: FulfillmentLineDto[]

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

  @IsString() correlationId!: string
}

export class CancelFulfillmentDto {
  @IsString() correlationId!: string
}
