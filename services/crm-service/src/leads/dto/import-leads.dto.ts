import { Type } from 'class-transformer'
import { IsArray, IsIn, IsOptional, ValidateNested } from 'class-validator'
import { CreateLeadDto } from './create-lead.dto'
import { LEAD_KANBAN_STATUSES } from './patch-lead.dto'

export class LeadImportRowDto extends CreateLeadDto {
  @IsOptional()
  @IsIn([...LEAD_KANBAN_STATUSES])
  status?: (typeof LEAD_KANBAN_STATUSES)[number]
}

export class ImportLeadsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadImportRowDto)
  rows!: LeadImportRowDto[]
}
