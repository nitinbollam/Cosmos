import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class CreateCartonDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightGrams?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  lengthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  widthCm?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  heightCm?: number
}

export class AddCartonItemDto {
  @IsString()
  skuId!: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number
}

export class SealCartonDto {
  @IsString()
  carrier!: string

  @IsOptional()
  @IsString()
  serviceLevel?: string
}
