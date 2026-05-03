import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class VoidSaleDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  voidedBy!: string
}
