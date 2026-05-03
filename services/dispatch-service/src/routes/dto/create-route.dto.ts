import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class RouteStopInputDto {
  @IsInt()
  @Min(1)
  sequence!: number

  @IsObject()
  address!: Record<string, unknown>
}

export class CreateRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RouteStopInputDto)
  stops!: RouteStopInputDto[]
}
