import { Type } from 'class-transformer'
import { IsNumber, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'

export class CloseShiftDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  closingCash!: number

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  closedBy!: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  note?: string
}
