import { IsString, MaxLength, MinLength } from 'class-validator'

export class ConvertLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  customerName!: string
}
