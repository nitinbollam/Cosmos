import { IsBoolean, IsOptional } from 'class-validator'

export class PatchWarehouseDto {
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean
}
