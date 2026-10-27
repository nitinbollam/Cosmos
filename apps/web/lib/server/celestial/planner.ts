/**
 * AI router for questions the keyword rules don't recognise ("bounded structured planner").
 *
 * The model sees only the question and the lookups this employee may run — no ERP records — and
 * answers with one JSON object: run one lookup, treat it as a how-to question, or say Pleros holds
 * no data for it. Everything it returns is validated against the closed vocabularies below; unknown
 * tools, unknown fields and bad values are dropped, and permissions are checked again when the tool
 * runs. A slow or malformed reply falls back to the previous behaviour.
 */
import type { SessionUser } from '../session'
import {
  OPEN_ORDER_STATUSES,
  OPEN_PO_STATUSES,
  BILL_STATUSES,
  ORDER_CHANNELS,
  ORDER_PRIORITIES,
  ORDER_STATUSES,
  PO_STATUSES,
  QUOTE_STATUSES,
  productSearchTokens,
  resolveDateRange,
} from './erp-query-contracts'
import type { CelestialToolName, DetectedIntent } from './intent'
import { completeChat, type ChatMessage, type LlmOptions } from './llm'
import { withDeadline } from './record-summary'
import { canUseTool } from './tools'

const DEFAULT_PLANNER_TIMEOUT_MS = 4_000

type Env = Record<string, string | undefined>

/** What each routable tool does and which fields it accepts, as shown to the planner. */
const CATALOG: Partial<Record<CelestialToolName, { does: string; fields: string }>> = {
  'orders.list': {
    does: 'list sales orders (limit 1 returns that one order in full)',
    fields: `orderStatus (${ORDER_STATUSES.join('|')}|OPEN = not yet shipped), customer (name), channel (${ORDER_CHANNELS.join('|')}), priority (${ORDER_PRIORITIES.join('|')}), period, sort (asc=oldest first|desc), byAmount (true = order by value), limit (1 for "the latest/biggest order")`,
  },
  'orders.detail': { does: 'one sales order', fields: 'orderNumber (number from ORD-1234)' },
  'inventory.stock': {
    does: 'stock levels per product and warehouse, or rank products by stock',
    fields: 'search (product words), warehouse (name), stockRank (asc=least stock|desc=most stock), limit (1-10; 1 when they want just the top/bottom one)',
  },
  search_catalog: {
    does: 'find products by name or SKU with price, or rank products by price',
    fields: 'search (product words), priceRank (asc=cheapest|desc=most expensive), limit',
  },
  list_low_stock: { does: 'products at or below their reorder point', fields: 'none' },
  list_warehouses: { does: 'list warehouses', fields: 'none' },
  'purchasing.orders': {
    does: 'list purchase orders to suppliers (limit 1 returns that PO in full)',
    fields: `poStatus (${PO_STATUSES.join('|')}|OPEN = still to be received), supplier, period, limit`,
  },
  'purchasing.order_detail': { does: 'one purchase order', fields: 'poRef (PO-1234)' },
  'finance.bills': {
    does: 'vendor bills / accounts payable (money we owe suppliers)',
    fields: `billStatus (${BILL_STATUSES.join('|')}), outstanding (true|false), pastDue (true), supplier, period`,
  },
  list_my_invoices: {
    does: 'customer invoices / accounts receivable (money customers owe us)',
    fields: 'customer, outstanding (true = unpaid only)',
  },
  'quotes.list': {
    does: 'list customer quotes, incl. whether converted to an order (limit 1 returns that quote in full)',
    fields: `quoteStatus (${QUOTE_STATUSES.join('|')}), customer, period, limit`,
  },
  'quotes.detail': { does: 'one quote', fields: 'quoteRef (the part after Q-)' },
  'sales.summary': { does: 'sales revenue, order count and average order value for a period', fields: 'period' },
  'sales.by_customer': {
    does: 'rank customers by revenue (best / biggest customers)',
    fields: 'salesRank (desc=best|asc=smallest), period, limit (1 for "the best customer")',
  },
  'purchasing.suppliers': { does: 'list suppliers with contact details, POs and what we owe them', fields: 'none' },
  'inventory.by_warehouse': {
    does: 'stock totals per warehouse (which warehouse holds the most/least)',
    fields: 'stockRank (desc=most|asc=least), limit',
  },
  'sales.forecast': { does: 'projected sales for next quarter from past quarters', fields: 'none' },
  'sales.by_product': {
    does: 'rank products by sales (best or worst sellers)',
    fields: 'salesRank (desc=best sellers|asc=worst sellers), search (product words), period, limit (1-10; 1 when they want just the top/bottom one)',
  },
  global_search: { does: 'search customers, orders and products by name', fields: 'search' },
}

export function plannerTimeoutMs(env: Env = process.env): number {
  const n = Number(env.CELESTIAL_PLANNER_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PLANNER_TIMEOUT_MS
}

/** The tools this session may use, in catalog order. */
export function allowedPlannerTools(session: SessionUser): CelestialToolName[] {
  return (Object.keys(CATALOG) as CelestialToolName[]).filter((t) => canUseTool(session, t))
}

/** Up to this many lookups may run for one question. */
export const MAX_PLANNED_CALLS = 3

/** One earlier turn, as the router sees it: the question and the lookups it ran (settings only, no records). */
export type PlannerTurn = { question: string; lookups: string }

export function buildPlannerMessages(question: string, tools: CelestialToolName[], earlier: PlannerTurn[] = []): ChatMessage[] {
  const lines = tools.map((t) => `- ${t}: ${CATALOG[t]!.does}. Fields: ${CATALOG[t]!.fields}`)
  const context =
    earlier.length > 0
      ? `\nEarlier in this chat (oldest first):\n${earlier.map((e) => `- Asked: "${e.question}" → ${e.lookups || 'no lookup'}`).join('\n')}\nIf the new question only refines the last one ("and last month?", "only the unpaid ones", "what about Pacific?"), repeat that lookup with the change applied. Words like "it", "that", "those", "them" or "the customer" refer to the records from the last lookup: repeat that lookup (the answer will contain the detail asked for) instead of asking which one.`
      : ''
  return [
    {
      role: 'system',
      content: `You route questions for Celestial, the assistant inside the Pleros wholesale ERP. Reply with ONE JSON object and nothing else.
Lookups available to this employee:
${lines.join('\n')}
"period" is a phrase like "today", "last month", "this quarter", "last quarter", "q2 2026" or "last 30 days".${context}
Reply with exactly one of:
{"type":"tools","calls":[{"tool":"<name>","params":{...}}]}  — 1 to ${MAX_PLANNED_CALLS} lookups. Use 2+ only when the question needs them, e.g. comparing two periods (same tool, different period) or a record plus related records.
{"type":"clarify","question":"<short question>","options":["<option>","<option>"]}  — the question could reasonably mean different lookups (e.g. "balance" = customer invoices or supplier bills) and the chat doesn't settle it. 2 or 3 short options.
{"type":"knowledge"}   — a how-to or "how does Pleros work" question, answered from product guides
{"type":"unsupported"} — asks for data none of the lookups provide
Only use listed tools and fields. Never invent tool names, fields or values.`,
    },
    { role: 'user', content: question },
  ]
}

export type Plan =
  | { type: 'tools'; calls: DetectedIntent[] }
  | { type: 'clarify'; question: string; options: string[] }
  | { type: 'knowledge' }
  | { type: 'unsupported' }

function pick<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim().toUpperCase()
  return (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

function shortText(value: unknown, max = 60): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  return v && v.length <= max ? v : undefined
}

function direction(value: unknown): 'asc' | 'desc' | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined
}

/** One validated lookup, or null when the tool is unknown, not allowed or missing a required reference. */
function parseCall(raw: unknown, allowed: CelestialToolName[], now: Date): DetectedIntent | null {
  if (!raw || typeof raw !== 'object') return null
  const { tool: rawTool, params } = raw as { tool?: unknown; params?: unknown }
  if (typeof rawTool !== 'string') return null
  const tool = rawTool as CelestialToolName
  if (!allowed.includes(tool)) return null

  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  const intent: DetectedIntent = { tools: [tool] }
  const period = shortText(p.period)
  if (period) intent.dateRange = resolveDateRange(period, now)
  const search = shortText(p.search, 80)
  if (search) {
    intent.searchTokens = productSearchTokens(search)
    intent.searchTerm = search
  }
  if (typeof p.orderStatus === 'string' && p.orderStatus.trim().toUpperCase() === 'OPEN') intent.orderStatuses = OPEN_ORDER_STATUSES
  else intent.orderStatus = pick(p.orderStatus, ORDER_STATUSES)
  intent.customer = shortText(p.customer)
  intent.warehouse = shortText(p.warehouse)
  intent.priceRank = direction(p.priceRank)
  if (p.byAmount === true) intent.byAmount = true
  intent.channel = pick(p.channel, ORDER_CHANNELS)
  intent.priority = pick(p.priority, ORDER_PRIORITIES)
  if (typeof p.poStatus === 'string' && p.poStatus.trim().toUpperCase() === 'OPEN') intent.poStatuses = OPEN_PO_STATUSES
  else intent.poStatus = pick(p.poStatus, PO_STATUSES)
  intent.billStatus = pick(p.billStatus, BILL_STATUSES)
  intent.quoteStatus = pick(p.quoteStatus, QUOTE_STATUSES)
  intent.sort = direction(p.sort)
  intent.stockRank = direction(p.stockRank)
  intent.salesRank = direction(p.salesRank)
  const limit = Number(p.limit)
  if (Number.isInteger(limit) && limit >= 1 && limit <= 10) intent.limit = limit
  intent.supplier = shortText(p.supplier)
  if (typeof p.outstanding === 'boolean') intent.outstanding = p.outstanding
  if (p.pastDue === true) intent.pastDue = true
  const orderNumber = Number(p.orderNumber)
  if (Number.isSafeInteger(orderNumber) && orderNumber > 0) intent.orderNumber = orderNumber
  const poRef = shortText(p.poRef)?.match(/^PO[-\s#]*(\d+)$/i)
  if (poRef) intent.poRef = `PO-${poRef[1]}`
  const quoteRef = shortText(p.quoteRef)?.replace(/^Q-/i, '')
  if (quoteRef && /^[A-Za-z0-9_]{4,}$/.test(quoteRef)) intent.quoteRef = quoteRef.toLowerCase()

  // Detail lookups without a reference can't run.
  if (tool === 'orders.detail' && intent.orderNumber == null) return null
  if (tool === 'purchasing.order_detail' && !intent.poRef) return null
  if (tool === 'quotes.detail' && !intent.quoteRef) return null
  return intent
}

/** Parse and validate the router's reply. Anything unrecognised yields null (keep keyword routing). */
export function parsePlan(text: string | null | undefined, allowed: CelestialToolName[], now = new Date()): Plan | null {
  const raw = (text ?? '').match(/\{[\s\S]*\}/)?.[0]
  if (!raw) return null
  let obj: { type?: unknown; tool?: unknown; params?: unknown; calls?: unknown; question?: unknown; options?: unknown }
  try {
    obj = JSON.parse(raw)
  } catch {
    // Not JSON: treat as no plan and keep the existing routing.
    return null
  }
  if (obj.type === 'knowledge') return { type: 'knowledge' }
  if (obj.type === 'unsupported') return { type: 'unsupported' }
  if (obj.type === 'clarify') {
    const question = shortText(obj.question, 160)
    const options = (Array.isArray(obj.options) ? obj.options : [])
      .map((o) => shortText(o, 80))
      .filter((o): o is string => Boolean(o))
      .slice(0, 3)
    return question && options.length >= 2 ? { type: 'clarify', question, options } : null
  }
  // A single {"type":"tool"} reply is accepted as a one-call plan.
  const rawCalls = obj.type === 'tool' ? [obj] : obj.type === 'tools' && Array.isArray(obj.calls) ? obj.calls : null
  if (!rawCalls) return null
  const calls = rawCalls
    .slice(0, MAX_PLANNED_CALLS)
    .map((c) => parseCall(c, allowed, now))
    .filter((c): c is DetectedIntent => c != null)
  return calls.length > 0 ? { type: 'tools', calls } : null
}

/** Ask the model to route the question; null when unavailable, slow or unparseable. */
export async function planQuestion(
  question: string,
  session: SessionUser,
  opts: LlmOptions = {},
  earlier: PlannerTurn[] = [],
): Promise<Plan | null> {
  const allowed = allowedPlannerTools(session)
  if (allowed.length === 0) return null
  const env = opts.env ?? process.env
  const reply = await withDeadline(
    completeChat(buildPlannerMessages(question, allowed, earlier.slice(-3)), opts),
    plannerTimeoutMs(env),
  )
  return parsePlan(reply?.content, allowed)
}

/** A lookup as the router reads it in chat context: `finance.bills(outstanding=true, supplier=Pacific)`. */
export function describeLookup(tool: string, params: Record<string, unknown>): string {
  const parts = Object.entries(params)
    .filter(([k, v]) => v !== undefined && v !== null && k !== 'tools' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => {
      if (k === 'dateRange' && v && typeof v === 'object') return `period=${(v as { label?: string }).label ?? '?'}`
      return `${k}=${Array.isArray(v) ? v.join(' ') : String(v)}`
    })
  return `${tool}(${parts.join(', ')})`
}

/** Server-written clarifying question built from the router's options. */
export function clarifyReply(plan: { question: string; options: string[] }): string {
  return [plan.question, '', ...plan.options.map((o) => `- ${o}`)].join('\n')
}

const AMBIGUOUS =
  /\b(balance|balances|outstanding|owed?|owing|unpaid|due|overdue|open items?|what'?s pending)\b/
const DIRECTIONAL =
  /\b(invoices?|bills?|vendors?|suppliers?|customers?|receivables?|payables?|a\/r|a\/p|orders?|quotes?|purchase|po\b|we owe|owes us)\b/
const REFINEMENT = /^(and|but|also|what about|how about|only|just|same|now|then|instead|except|what if)\b/
const SEVERAL = /\b(compare|compared|comparison|vs\.?|versus|against|as well as|along with|together with|and (its|their|the related)|plus)\b/

/**
 * Why the keyword routing should be double-checked by the AI router, or null when it is confident.
 * Exact references (ORD-, PO-, Q-) are always trusted.
 */
export function routingDoubt(message: string, keyword: DetectedIntent, hasEarlierTurns: boolean): string | null {
  const lower = message.toLowerCase().trim()
  if (/\bORD-\d+|\bPO[-\s#]*\d+|\bQ-[A-Z0-9_]{4,}/i.test(message)) return null
  if (keyword.tools.length === 0) return 'no keyword match'
  if (keyword.tools.length > 1) return 'several lookups matched'
  if (SEVERAL.test(lower)) return 'may need several lookups'
  if (hasEarlierTurns && (REFINEMENT.test(lower) || lower.split(/\s+/).length <= 4)) return 'looks like a follow-up'
  if (AMBIGUOUS.test(lower) && !DIRECTIONAL.test(lower)) return 'ambiguous wording'
  return null
}

const TOOL_TOPICS: Partial<Record<CelestialToolName, string>> = {
  'orders.list': 'orders',
  'inventory.stock': 'stock levels',
  'purchasing.orders': 'purchase orders',
  'finance.bills': 'vendor bills',
  list_my_invoices: 'invoices',
  'quotes.list': 'quotes',
  'sales.summary': 'sales totals',
  'sales.by_product': 'sales by product',
  'sales.by_customer': 'top customers',
  'purchasing.suppliers': 'suppliers',
  list_warehouses: 'warehouses',
}

/** Fixed reply for questions no lookup covers — written by the server, never by the model. */
export function unsupportedReply(question: string, session: SessionUser): string {
  const topics = allowedPlannerTools(session)
    .map((t) => TOOL_TOPICS[t])
    .filter((t): t is string => Boolean(t))
  return [
    `Pleros doesn't have data I can use to answer “${question.trim().slice(0, 160)}”.`,
    '',
    topics.length > 0
      ? `I can look up ${topics.slice(0, -1).join(', ')}${topics.length > 1 ? ' and ' : ''}${topics[topics.length - 1]}, or explain how a Pleros screen works.`
      : 'I can explain how Pleros screens and workflows work.',
  ].join('\n')
}
