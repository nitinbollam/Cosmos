import { IsString, MaxLength, MinLength } from 'class-validator'

export class AssignDriverDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  driverId!: string
}
