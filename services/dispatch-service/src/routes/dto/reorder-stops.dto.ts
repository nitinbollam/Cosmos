import { ArrayMinSize, IsArray, IsString } from 'class-validator'

export class ReorderStopsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  stopIds!: string[]
}
