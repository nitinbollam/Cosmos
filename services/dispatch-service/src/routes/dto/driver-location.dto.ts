import { Type } from 'class-transformer'
import { IsNumber, IsOptional, IsISO8601, IsString, Max, Min } from 'class-validator'

export class DriverLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  lat!: number

  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  lng!: number

  @IsOptional()
  @IsISO8601()
  timestamp?: string

  /** When set, updates last-known position on the route (must be assigned driver). */
  @IsOptional()
  @IsString()
  routeId?: string
}
