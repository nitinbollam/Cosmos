/**
 * AI-written summaries above records answers.
 *
 * The server still builds every table, count and amount. The model only adds one to three plain
 * sentences on top, and a summary is dropped (the table is shown alone) when it:
 *   - cites any number that is not in the evidence or the question,
 *   - contains a table or heading, or runs long,
 *   - arrives after the summary deadline, or the provider fails.
 * Summaries run only when ERP data may be shared with the configured providers.
 */
import type { ChatMessage } from './llm'
import type { ToolResult } from './tools'

const DEFAULT_SUMMARY_TIMEOUT_MS = 6_000
const MAX_SUMMARY_CHARS = 600

type Env = Record<string, string | undefined>

export function summaryTimeoutMs(env: Env = process.env): number {
  const n = Number(env.CELESTIAL_SUMMARY_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SUMMARY_TIMEOUT_MS
}

/**
 * Whether this answer gets a summary: the deployment allows it, the model may see ERP data, and at
 * least one lookup returned records (access notices and clarifying questions are left as they are).
 */
export function shouldSummarize(
  toolResults: ToolResult[],
  opts: { modelConfigured: boolean; shareErpData: boolean; clarification: boolean },
  env: Env = process.env,
): boolean {
  if (env.CELESTIAL_RECORD_SUMMARIES?.trim().toLowerCase() === 'false') return false
  if (!opts.modelConfigured || !opts.shareErpData || opts.clarification) return false
  const answered = toolResults.filter((r) => !r.notice && !r.error && r.data != null)
  // A single-answer result ("which product has the most…") is already one sentence.
  if (answered.length > 0 && answered.every((r) => (r.data as { limit?: number }).limit === 1)) return false
  return answered.length > 0
}

export function buildSummaryMessages(question: string, evidence: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You summarise Pleros ERP lookup results for an employee, above a table they will see in full.
Rules:
- Write 1 to 3 short sentences of plain text. No headings, lists, tables or links.
- Answer the employee's question directly from the evidence: the key record(s), status, amounts or dates that matter.
- Use only facts in the evidence. Never add, estimate, round, add up or convert numbers; copy figures exactly as shown.
- Write amounts exactly as the evidence does: if the evidence shows no currency symbol for an amount, don't add one.
- If only some matches are shown, say so. If nothing matched, say that plainly and suggest one way to narrow or change the search.
- If an access notice is in the evidence, mention that part could not be shown.
- Don't repeat the whole table, and don't mention tools, JSON or the database.`,
    },
    { role: 'user', content: `Question: ${question}\n\nEvidence (what the employee sees below your summary):\n${evidence}` },
  ]
}

/** Numbers as comparable strings: commas dropped, trailing decimal zeros removed ("3,980.00" → "3980"). */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const n = Number(raw.replace(/,/g, ''))
    if (Number.isFinite(n)) out.add(String(n))
  }
  return out
}

/** True when every number in the summary appears in the evidence or the question. */
export function numbersSupported(summary: string, evidence: string, question = ''): boolean {
  const allowed = numbersIn(`${evidence}\n${question}`)
  for (const n of numbersIn(summary)) if (!allowed.has(n)) return false
  return true
}

/** True unless the summary uses a currency symbol or code the evidence never shows (orders store none). */
export function currencySupported(summary: string, evidence: string): boolean {
  for (const c of new Set(summary.match(/[$€£¥]|\b(?:USD|EUR|GBP|CAD|INR)\b/g) ?? [])) {
    if (!evidence.includes(c)) return false
  }
  return true
}

/** Trimmed summary text, or null when it isn't a short plain-prose summary. */
export function cleanSummary(text: string | null | undefined): string | null {
  const t = (text ?? '').trim()
  if (!t || t.length > MAX_SUMMARY_CHARS) return null
  if (/^\s*#|^\s*\|.*\|/m.test(t)) return null
  return t
}

/** The validated summary, or null if it should be dropped. */
export function acceptSummary(text: string | null | undefined, evidence: string, question: string): string | null {
  const s = cleanSummary(text)
  if (!s) return null
  return numbersSupported(s, evidence, question) && currencySupported(s, evidence) ? s : null
}

/** Resolve within `ms`, or null; a late provider answer is discarded. */
export async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([work.catch(() => null), deadline]) // swallow-ok: provider failures are logged in llm.ts; the table is shown without a summary
  } finally {
    clearTimeout(timer)
  }
}
