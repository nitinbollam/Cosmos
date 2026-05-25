import { IsInt, IsOptional, IsString, ValidateIf } from 'class-validator'

export class PatchStockLevelDto {
  @IsOptional() @IsInt() reorderPoint?: number
  @IsOptional() @IsInt() reorderQty?: number
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsString()
  locationId?: string | null
}
