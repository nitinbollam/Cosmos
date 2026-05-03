import { Type } from 'class-transformer'
import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator'

export class OpenShiftDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  registerId!: string

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  openingCash!: number

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  openedBy!: string
}
