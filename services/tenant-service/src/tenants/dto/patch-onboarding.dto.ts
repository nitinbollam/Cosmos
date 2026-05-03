import { IsBoolean, IsObject, IsOptional } from 'class-validator'

export class PatchOnboardingStepDto {
  @IsOptional()
  @IsBoolean()
  completed?: boolean

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>
}
