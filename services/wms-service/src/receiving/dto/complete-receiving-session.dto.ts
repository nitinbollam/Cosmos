import { IsOptional, IsString, MaxLength } from 'class-validator'

export class CompleteReceivingSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string
}
