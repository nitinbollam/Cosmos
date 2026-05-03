import { IsObject, IsString } from 'class-validator'

export class ReplayDto {
  @IsString() action!: string
  @IsObject() payload!: Record<string, unknown>
}
