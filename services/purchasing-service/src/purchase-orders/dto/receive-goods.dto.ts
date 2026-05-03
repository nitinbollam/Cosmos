import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator'

export class ReceiveLineDto {
  @IsString()
  lineId!: string

  @IsInt()
  @Min(0)
  qtyReceived!: number
}

export class ReceiveGoodsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[]
}
