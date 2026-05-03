import { IsString, MaxLength, MinLength } from 'class-validator'

export class CreateRegisterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name!: string
}
