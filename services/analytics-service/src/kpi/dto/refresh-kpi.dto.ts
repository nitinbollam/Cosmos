import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'

export class RefreshKpiDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  tenantId?: string

  @IsDateString()
  date!: string

  @IsInt()
  @Min(0)
  ordersCount!: number

  /** Decimal as number for JSON body */
  @Type(() => Number)
  revenue!: number

  @IsInt()
  @Min(0)
  skusActive!: number
}
