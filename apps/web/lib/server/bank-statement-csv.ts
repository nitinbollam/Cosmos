import { createHash } from 'node:crypto'
import { Prisma } from '@/generated/prisma-ledger'
import { ApiError } from './session'

/**
 * Statement parsing and validation for bank reconciliation. Pure functions: no database access.
 * Money is parsed from text straight into Decimal; JS numbers are never used for amounts.
 */

export const MAX_STATEMENT_ROWS = 5000
const MAX_DESCRIPTION = 500
const MAX_REFERENCE = 100
const MONEY_RE = /^[+-]?\d{1,13}(\.\d{1,2})?$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

/** Strict money: up to 13 integer digits and 2 decimals. Numbers are accepted only if their text form is strict. */
export function parseMoney(value: unknown): Prisma.Decimal | null {
  let text: string
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    text = String(value)
  } else if (typeof value === 'string') {
    text = value.trim().replace(/,/g, '')
  } else return null
  if (!MONEY_RE.test(text)) return null
  return new Prisma.Decimal(text)
}

export function requireMoney(value: unknown, field: string): Prisma.Decimal {
  const d = parseMoney(value)
  if (!d) throw new ApiError(400, `${field} must be an amount with at most 2 decimals`)
  return d
}

/** YYYY-MM-DD only, real calendar dates, returned as 00:00 UTC. */
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const m = DATE_RE.exec(value.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date
}

export function requireIsoDate(value: unknown, field: string): Date {
  const d = parseIsoDate(value)
  if (!d) throw new ApiError(400, `${field} must be a date in YYYY-MM-DD format`)
  return d
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS)
}

/** Whole calendar days between two instants, compared as UTC dates. */
export function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfUtcDay(a).getTime() - startOfUtcDay(b).getTime()) / DAY_MS)
}

export function money(d: Prisma.Decimal): string {
  return d.toFixed(2)
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
      } else field += c
      i++
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (c === '\r' && text[i + 1] === '\n') i++
    } else field += c
    i++
  }
  if (quoted) throw new ApiError(400, 'CSV has an unterminated quoted field')
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export type CsvMapping = {
  date: string
  description: string
  amount?: string
  /** Money out of the account (bank convention), recorded as a negative amount. */
  debit?: string
  /** Money into the account, recorded as a positive amount. */
  credit?: string
  reference?: string
}

const HEADER_ALIASES: Record<keyof CsvMapping, string[]> = {
  date: ['date', 'posted date', 'posting date', 'transaction date', 'posted at'],
  description: ['description', 'memo', 'payee', 'details', 'narrative'],
  amount: ['amount', 'net amount'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'money out'],
  credit: ['credit', 'deposit', 'deposits', 'money in'],
  reference: ['reference', 'ref', 'check number', 'cheque number', 'transaction id'],
}

function resolveMapping(header: string[], mapping?: Partial<CsvMapping>): Record<keyof CsvMapping, number> {
  const norm = header.map((h) => h.trim().toLowerCase())
  const find = (key: keyof CsvMapping): number => {
    const explicit = mapping?.[key]
    if (explicit !== undefined) {
      const idx = norm.indexOf(String(explicit).trim().toLowerCase())
      if (idx < 0) throw new ApiError(400, `Mapped column "${explicit}" for ${key} is not in the CSV header`)
      return idx
    }
    return norm.findIndex((h) => HEADER_ALIASES[key].includes(h))
  }
  const cols = {
    date: find('date'),
    description: find('description'),
    amount: find('amount'),
    debit: find('debit'),
    credit: find('credit'),
    reference: find('reference'),
  }
  if (cols.date < 0) throw new ApiError(400, 'CSV needs a date column')
  if (cols.description < 0) throw new ApiError(400, 'CSV needs a description column')
  if (cols.amount < 0 && (cols.debit < 0 || cols.credit < 0)) {
    throw new ApiError(400, 'CSV needs an amount column, or both debit and credit columns')
  }
  return cols
}

export type StatementRowInput = {
  /** 1-based row number in the source (CSV data rows start at 2, after the header). */
  row: number
  postedAt: unknown
  description: unknown
  amount?: unknown
  debit?: unknown
  credit?: unknown
  reference?: unknown
}

export type ValidStatementLine = {
  row: number
  postedAt: Date
  description: string
  amount: Prisma.Decimal
  reference: string | null
}

export type RowError = { row: number; message: string }

export function validateStatementRows(
  inputs: StatementRowInput[],
  opts: { periodStart?: Date; periodEnd?: Date } = {},
): { lines: ValidStatementLine[]; errors: RowError[] } {
  if (inputs.length === 0) throw new ApiError(400, 'Statement has no rows')
  if (inputs.length > MAX_STATEMENT_ROWS) throw new ApiError(400, `Statement has more than ${MAX_STATEMENT_ROWS} rows`)
  const lines: ValidStatementLine[] = []
  const errors: RowError[] = []
  for (const input of inputs) {
    const rowErrors: string[] = []
    const postedAt = parseIsoDate(input.postedAt)
    if (!postedAt) rowErrors.push('date must be YYYY-MM-DD')
    else if (opts.periodStart && opts.periodEnd && (postedAt < opts.periodStart || postedAt > opts.periodEnd)) {
      rowErrors.push(`date ${isoDate(postedAt)} is outside the statement period`)
    }
    const description = typeof input.description === 'string' ? input.description.trim() : ''
    if (!description) rowErrors.push('description is required')
    else if (description.length > MAX_DESCRIPTION) rowErrors.push(`description is longer than ${MAX_DESCRIPTION} characters`)

    let amount: Prisma.Decimal | null = null
    const hasAmount = input.amount !== undefined && String(input.amount).trim() !== ''
    const hasDebit = input.debit !== undefined && String(input.debit).trim() !== ''
    const hasCredit = input.credit !== undefined && String(input.credit).trim() !== ''
    if (hasAmount) {
      amount = parseMoney(input.amount)
      if (!amount) rowErrors.push('amount must be a number with at most 2 decimals')
    } else if (hasDebit !== hasCredit) {
      const parsed = parseMoney(hasDebit ? input.debit : input.credit)
      if (!parsed || parsed.isNegative()) rowErrors.push(`${hasDebit ? 'debit' : 'credit'} must be a positive amount`)
      else amount = hasDebit ? parsed.negated() : parsed
    } else rowErrors.push(hasDebit ? 'only one of debit or credit may be filled' : 'amount is required')
    if (amount?.isZero()) rowErrors.push('amount must not be zero')

    const refRaw = input.reference
    const reference = typeof refRaw === 'string' && refRaw.trim() ? refRaw.trim() : null
    if (refRaw !== undefined && refRaw !== null && typeof refRaw !== 'string') rowErrors.push('reference must be text')
    if (reference && reference.length > MAX_REFERENCE) rowErrors.push(`reference is longer than ${MAX_REFERENCE} characters`)

    if (rowErrors.length) errors.push({ row: input.row, message: rowErrors.join('; ') })
    else lines.push({ row: input.row, postedAt: postedAt!, description, amount: amount!, reference })
  }
  return { lines, errors }
}

export function normalizeStatementText(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim()
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function parseStatementCsv(
  csvText: unknown,
  mapping?: Partial<CsvMapping>,
  opts: { periodStart?: Date; periodEnd?: Date } = {},
): { lines: ValidStatementLine[]; errors: RowError[]; fileSha256: string; rowCount: number } {
  if (typeof csvText !== 'string' || !csvText.trim()) throw new ApiError(400, 'csvText is required')
  const normalized = normalizeStatementText(csvText)
  const [header, ...data] = parseCsv(normalized)
  if (!header) throw new ApiError(400, 'CSV is empty')
  const cols = resolveMapping(header, mapping)
  const cell = (r: string[], idx: number) => (idx >= 0 ? r[idx] : undefined)
  const inputs: StatementRowInput[] = data.map((r, i) => ({
    row: i + 2,
    postedAt: cell(r, cols.date),
    description: cell(r, cols.description),
    amount: cell(r, cols.amount),
    debit: cell(r, cols.debit),
    credit: cell(r, cols.credit),
    reference: cell(r, cols.reference),
  }))
  return { ...validateStatementRows(inputs, opts), fileSha256: sha256Hex(normalized), rowCount: inputs.length }
}

/**
 * Row identity for duplicate detection. Identical rows within one file are told apart by their
 * occurrence index, so re-importing the same rows (in any file) is detected while a statement that
 * genuinely lists two equal transactions keeps both.
 */
export function withDedupeKeys<T extends ValidStatementLine>(bankAccountId: string, lines: T[]): (T & { dedupeKey: string })[] {
  const seen = new Map<string, number>()
  return lines.map((l) => {
    const base = [
      bankAccountId,
      isoDate(l.postedAt),
      l.amount.toFixed(2),
      (l.reference ?? '').toUpperCase(),
      l.description.replace(/\s+/g, ' ').toUpperCase(),
    ].join('|')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { ...l, dedupeKey: sha256Hex(`${base}|${n}`) }
  })
}
