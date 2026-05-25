import { IsInt } from 'class-validator'

export class PatchCycleLineDto {
  @IsInt()
  countedQty!: number
}
