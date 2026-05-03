import { IsOptional, IsString, MinLength } from 'class-validator'

export class StartReceivingSessionDto {
  @IsString()
  @MinLength(1)
  warehouseId!: string

  @IsOptional()
  @IsString()
  poId?: string

  @IsOptional()
  @IsString()
  asnId?: string
}
