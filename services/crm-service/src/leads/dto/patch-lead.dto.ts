import {
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import { Type } from 'class-transformer'

export const LEAD_KANBAN_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const

export type LeadKanbanStatus = (typeof LEAD_KANBAN_STATUSES)[number]

export class PatchLeadDto {
  @IsOptional()
  @IsIn([...LEAD_KANBAN_STATUSES])
  status?: LeadKanbanStatus

  @IsOptional()
  @IsString()
  @MaxLength(256)
  companyName?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  contactName?: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pipelineValue?: number

  @IsOptional()
  @IsString()
  @MinLength(1)
  assignedToUserId?: string
}
