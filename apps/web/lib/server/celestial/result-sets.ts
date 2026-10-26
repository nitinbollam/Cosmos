/**
 * Scoped result-set memory for follow-ups ("open the second order", "show more").
 *
 * Each list answer stores, in its assistant message metadata, the tool, validated parameters,
 * page and up to MAX_REFS record references. A follow-up only selects a reference or the next
 * page; the record is then re-read through the normal permission-checked tool, so remembered
 * values are never presented as current facts. Sets expire after RESULT_SET_TTL_MS and are only
 * honoured for the same tenant, user and role that produced them.
 */
import { randomUUID } from 'node:crypto'
import type { CelestialToolName, DetectedIntent, ToolParams } from './intent'
import type { ToolResult } from './tools'
import { PAGE_SIZE } from './erp-query-contracts'

export const RESULT_SET_TTL_MS = 30 * 60 * 1000
export const MAX_REFS = 50

export type RefKind = 'order' | 'purchase_order' | 'quote' | 'sku'

export type ResultRef = { kind: RefKind; id: string; label: string }

/** ToolParams with dates as ISO strings, safe to store as JSON. */
type StoredParams = Omit<ToolParams, 'dateRange'> & { dateRange?: { from: string; to: string; label: string } }

export type ResultSet = {
  id: string
  tool: CelestialToolName
  params: StoredParams
  page: number
  total: number
  refs: ResultRef[]
  scope: { tenantId: string; userId: string; role: string }
  createdAt: string
}

type Scope = ResultSet['scope']

const LIST_TOOLS: Partial<Record<CelestialToolName, RefKind>> = {
  'orders.list': 'order',
  'purchasing.orders': 'purchase_order',
  'quotes.list': 'quote',
  search_catalog: 'sku',
}

function refsFor(result: ToolResult, kind: RefKind): ResultRef[] {
  const rows = (result.data as { rows?: Array<Record<string, unknown>> } | null)?.rows ?? []
  return rows.slice(0, MAX_REFS).map((r) => {
    const id = String(r.id)
    switch (kind) {
      case 'order':
        return { kind, id, label: r.orderNumber != null ? `ORD-${r.orderNumber}` : `ORD-${id.slice(-6).toUpperCase()}` }
      case 'purchase_order':
        return { kind, id, label: String(r.number) }
      case 'quote':
        return { kind, id, label: String(r.quoteNumber) }
      case 'sku':
        return { kind, id, label: String(r.code) }
    }
  })
}

function storeParams(params: ToolParams): StoredParams {
  const { dateRange, ...rest } = params
  return {
    ...rest,
    ...(dateRange ? { dateRange: { from: dateRange.from.toISOString(), to: dateRange.to.toISOString(), label: dateRange.label } } : {}),
  }
}

function loadParams(params: StoredParams): ToolParams {
  const { dateRange, ...rest } = params
  return {
    ...rest,
    ...(dateRange ? { dateRange: { from: new Date(dateRange.from), to: new Date(dateRange.to), label: dateRange.label } } : {}),
  }
}

/** Result sets for the list tools in this answer (only results that returned rows). */
export function buildResultSets(results: ToolResult[], params: ToolParams, scope: Scope, now = new Date()): ResultSet[] {
  const sets: ResultSet[] = []
  for (const result of results) {
    const kind = LIST_TOOLS[result.name]
    if (!kind || result.notice || result.error) continue
    const page = result.data as { rows?: unknown[]; total?: number; page?: number } | null
    if (!page?.rows?.length) continue
    sets.push({
      id: randomUUID(),
      tool: result.name,
      params: storeParams({ ...params, page: undefined }),
      page: page.page ?? 1,
      total: page.total ?? page.rows.length,
      refs: refsFor(result, kind),
      scope,
      createdAt: now.toISOString(),
    })
  }
  return sets
}

/**
 * Live result sets from conversation metadata, newest first: unexpired and produced by the same
 * tenant, user and role. Malformed entries are ignored.
 */
export function liveResultSets(metadataNewestFirst: unknown[], scope: Scope, now = new Date()): ResultSet[] {
  const out: ResultSet[] = []
  for (const meta of metadataNewestFirst) {
    const sets = (meta as { resultSets?: unknown } | null)?.resultSets
    if (!Array.isArray(sets)) continue
    for (const raw of sets as ResultSet[]) {
      if (!raw || typeof raw !== 'object' || !Array.isArray(raw.refs) || !raw.scope) continue
      if (raw.scope.tenantId !== scope.tenantId || raw.scope.userId !== scope.userId || raw.scope.role !== scope.role) continue
      const age = now.getTime() - Date.parse(raw.createdAt)
      if (!(age >= 0 && age <= RESULT_SET_TTL_MS)) continue
      out.push(raw)
    }
  }
  return out
}

const ORDINALS: Record<string, number> = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5,
  sixth: 6, '6th': 6, seventh: 7, '7th': 7, eighth: 8, '8th': 8, ninth: 9, '9th': 9, tenth: 10, '10th': 10,
}

function ordinalOf(lower: string): number | 'last' | undefined {
  const word = lower.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|[4-9]th|10th)\b/)
  if (word) return ORDINALS[word[1]]
  const numbered = lower.match(/(?:\bnumber|\bno\.|#)\s*(\d{1,2})\b/)
  if (numbered) return Number(numbered[1])
  if (/\b(the )?last (one|order|po|purchase order|quote|product|item|sku)\b/.test(lower)) return 'last'
  return undefined
}

function kindHint(lower: string): RefKind | undefined {
  if (/\bpurchase orders?\b|\bpos?\b(?!\s*orders)/.test(lower)) return 'purchase_order'
  if (/\bquotes?\b/.test(lower)) return 'quote'
  if (/\b(products?|items?|skus?)\b/.test(lower)) return 'sku'
  if (/\borders?\b/.test(lower)) return 'order'
  return undefined
}

export type FollowUp =
  | { type: 'select'; set: ResultSet; ref: ResultRef; position: number }
  | { type: 'more'; set: ResultSet }
  | { type: 'out_of_range'; set: ResultSet; position: number }

/** Resolve a follow-up against live result sets. Undefined means "not a follow-up". */
export function resolveFollowUp(message: string, sets: ResultSet[]): FollowUp | undefined {
  if (sets.length === 0) return undefined
  const lower = message.toLowerCase()
  const hint = kindHint(lower)
  const candidates = hint ? sets.filter((s) => s.refs[0]?.kind === hint) : sets
  const set = candidates[0]
  if (!set) return undefined

  if (/\b(show|see|load|give me|list)\s+(me\s+)?(some\s+)?more\b|\bnext page\b|\bmore results\b|^\s*more\s*\??\s*$/.test(lower)) {
    return { type: 'more', set }
  }

  // Ordinals with an explicit record number ("order 1002") are lookups, not positions.
  if (/\bORD-\d+|\bPO[-\s#]*\d+|\bQ-[A-Z0-9]{4,}/i.test(message)) return undefined
  const pos = ordinalOf(lower)
  if (pos === undefined) return undefined
  const position = pos === 'last' ? set.refs.length : pos
  const ref = set.refs[position - 1]
  if (!ref) return { type: 'out_of_range', set, position }
  return { type: 'select', set, ref, position }
}

/** The tool call a follow-up maps to. Every selection is a fresh, permission-checked read. */
export function intentForFollowUp(f: FollowUp): DetectedIntent | { clarify: string } {
  if (f.type === 'out_of_range') {
    return { clarify: `The last list I showed has ${f.set.refs.length} row(s), so there is no item #${f.position}. Which one did you mean?` }
  }
  if (f.type === 'more') {
    const shownThrough = f.set.page * PAGE_SIZE
    if (shownThrough >= f.set.total) return { clarify: `That was everything — all ${f.set.total} match(es) are already shown.` }
    return { ...loadParams(f.set.params), page: f.set.page + 1, tools: [f.set.tool] }
  }
  const { ref } = f
  switch (ref.kind) {
    case 'order':
      return { tools: ['orders.detail'], orderId: ref.id }
    case 'purchase_order':
      return { tools: ['purchasing.order_detail'], poRef: ref.label }
    case 'quote':
      return { tools: ['quotes.detail'], quoteId: ref.id }
    case 'sku':
      return { tools: ['inventory.stock'], searchTokens: [ref.label] }
  }
}
