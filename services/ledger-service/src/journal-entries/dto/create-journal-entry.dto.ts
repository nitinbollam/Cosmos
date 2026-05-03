import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'
import { JournalLineInputDto } from './journal-line-input.dto'

export class CreateJournalEntryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string

  @IsOptional()
  @IsBoolean()
  fiscalPeriodClosed?: boolean

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineInputDto)
  lines!: JournalLineInputDto[]
}
