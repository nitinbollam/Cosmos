import { Prisma } from '../../generated/prisma-client'
import { IsNumber, IsOptional, IsString, Min, MaxLength, MinLength } from 'class-validator'

/** Accepts number; coerced to Decimal server-side. */
export class JournalLineInputDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  accountId!: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  memo?: string

  @IsNumber()
  @Min(0)
  debit!: number

  @IsNumber()
  @Min(0)
  credit!: number
}

export function toDecimal(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n)
}
