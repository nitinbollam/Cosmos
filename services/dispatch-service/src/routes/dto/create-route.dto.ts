import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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

  /** Start-of-day or full instant for the route’s operational date (admin list filter). */
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RouteStopInputDto)
  stops!: RouteStopInputDto[]
}
