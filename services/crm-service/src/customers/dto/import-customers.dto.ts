import { Type } from 'class-transformer'
import { IsArray, ValidateNested } from 'class-validator'
import { CreateCustomerDto } from './create-customer.dto'

export class ImportCustomersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCustomerDto)
  rows!: CreateCustomerDto[]
}
