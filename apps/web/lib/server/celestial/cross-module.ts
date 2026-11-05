/**
 * Bounded multi-domain reasoning (Phase 2).
 *
 * One question may run up to six lookups. This module keeps that bounded and grounded:
 *   - every lookup gets its own deadline inside an overall budget; a late lookup is reported as
 *     missing, never waited on and never silently dropped,
 *   - related lookups are linked through explicit edges only (the same supplier across purchase
 *     orders and vendor bills, the same customer across orders, invoices and quotes, the same
 *     product across stock, catalog and sales), so "Pacific's POs and their bills" can't end up
 *     comparing one supplier's POs with every bill,
 *   - comparisons (period changes, AR vs AP, a supplier's ordered vs billed amounts) are worked out
 *     here from all-match counts and totals. Page rows are only added up when the page holds every
 *     match, currencies are never mixed, and an unknown cost or a partial total stops the sum
 *     with a reason instead of being treated as zero.
 */
import { formatMoney, fromFloat } from '../money'
import { roundMoney } from './erp-query-contracts'
import type { CelestialToolName, DetectedIntent } from './intent'
import { TOOL_LABELS, type ToolResult } from './tools'

type Env = Record<string, string | undefined>

const DEFAULT_READ_TIMEOUT_MS = 5_000
const DEFAULT_READS_BUDGET_MS = 30_000

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function readTimeoutMs(env: Env = process.env): number {
  return positive(env.CELESTIAL_READ_TIMEOUT_MS, DEFAULT_READ_TIMEOUT_MS)
}

export function readsBudgetMs(env: Env = process.env): number {
  return positive(env.CELESTIAL_READS_BUDGET_MS, DEFAULT_READS_BUDGET_MS)
}

// ── Running lookups within the budget ───────────────────────────────────────

/** Notices standing in for a lookup that didn't answer in time. */
function timedOut(call: DetectedIntent): ToolResult[] {
  return call.tools.map((name) => ({
    name,
    data: null,
    links: [],
    error: 'timed out',
    notice: `Reading ${TOOL_LABELS[name]} took too long, so it is missing from this answer. Ask again in a moment.`,
  }))
}

/**
 * A clock shared by every lookup for one question. Each read waits at most the per-read timeout or
 * whatever is left of the overall budget, whichever is shorter. A read that misses its deadline is
 * replaced by a notice; its late result is discarded (the database query itself may still finish).
 */
export function readBudget(env: Env = process.env, now: () => number = Date.now) {
  const started = now()
  const perReadLimit = readTimeoutMs(env)
  const total = readsBudgetMs(env)
  return {
    remainingMs: () => Math.max(0, total - (now() - started)),
    async run(calls: DetectedIntent[], runCall: (call: DetectedIntent) => Promise<ToolResult[]>): Promise<ToolResult[][]> {
      return Promise.all(
        calls.map(async (call) => {
          // The per-read limit keeps one slow lookup from holding up the others; a question with a
          // single lookup has nothing to wait alongside, so only the overall budget applies.
          const perRead = calls.length > 1 ? perReadLimit : total
          const ms = Math.min(perRead, Math.max(0, total - (now() - started)))
          if (ms <= 0) return timedOut(call)
          let timer: ReturnType<typeof setTimeout> | undefined
          const deadline = new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), ms)
          })
          try {
            const result = await Promise.race([runCall(call), deadline])
            return result ?? timedOut(call)
          } finally {
            clearTimeout(timer)
          }
        }),
      )
    },
  }
}

// ── Relationship edges ──────────────────────────────────────────────────────

type Edge = {
  tools: CelestialToolName[]
  get: (c: DetectedIntent) => string | undefined
  /** `later` is true when the name was given in an earlier part of the question. */
  set: (c: DetectedIntent, from: DetectedIntent, later: boolean) => DetectedIntent
}

/** Lookups that describe the same supplier, customer or product, and the field that links them. */
const EDGES: Edge[] = [
  {
    tools: ['purchasing.requisitions', 'purchasing.orders', 'finance.bills'],
    get: (c) => c.supplier,
    set: (c, from) => ({ ...c, supplier: from.supplier }),
  },
  {
    tools: ['orders.list', 'list_my_invoices', 'quotes.list'],
    get: (c) => c.customer,
    set: (c, from, later) => ({ ...c, customer: from.customer, ...(later ? { customerCarried: true } : {}) }),
  },
  {
    tools: ['inventory.stock', 'search_catalog', 'sales.by_product'],
    get: (c) => c.searchTokens?.join(' ') || undefined,
    set: (c, from) => ({ ...c, searchTokens: from.searchTokens, searchTerm: from.searchTerm }),
  },
]

const keyOf = (c: DetectedIntent) => JSON.stringify(c)

/**
 * Link the lookups of one plan along the edges above. When a plan names one supplier (customer,
 * product) on some of its related lookups and leaves it off others, the others are narrowed to it.
 * Different names on purpose ("Pacific vs Acme") are left alone. Exact duplicates are dropped.
 */
export function linkCalls(calls: DetectedIntent[]): DetectedIntent[] {
  let linked = calls
  if (calls.length > 1) {
    for (const edge of EDGES) {
      const members = linked.filter((c) => c.tools.length === 1 && edge.tools.includes(c.tools[0]))
      // An edge links different lookups; the same lookup twice (two periods) is a comparison, not a link.
      if (new Set(members.map((c) => c.tools[0])).size < 2) continue
      const named = [...new Set(members.map(edge.get).filter((v): v is string => Boolean(v)))]
      if (named.length !== 1) continue
      const source = members.find((c) => edge.get(c) === named[0])!
      const current = linked
      linked = current.map((c) => (members.includes(c) && !edge.get(c) ? edge.set(c, source, current.indexOf(c) > current.indexOf(source)) : c))
    }
  }
  const seen = new Set<string>()
  return linked.filter((c) => {
    const k = keyOf(c)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * "Orders for Zorblax and open quotes": when the customer doesn't exist, the quotes are not narrowed
 * to a name that can only come back empty. The lookup that named the customer still reports it.
 * A name given last ("orders and quotes for Zorblax") covers every part and stays on them all.
 */
export async function settleCarriedCustomers(
  calls: DetectedIntent[],
  customerExists: (name: string) => Promise<boolean>,
): Promise<DetectedIntent[]> {
  if (!calls.some((c) => c.customerCarried)) return calls
  return Promise.all(
    calls.map(async ({ customerCarried, ...call }) =>
      customerCarried && call.customer && !(await customerExists(call.customer)) ? { ...call, customer: undefined } : call,
    ),
  )
}

// ── Deterministic comparisons ───────────────────────────────────────────────

type Lookup = { call: DetectedIntent; result: ToolResult }
type Data = Record<string, unknown>

/** Amount with its currency, matching the record tables: `$12.50`, `12.50 EUR`, or a bare amount. */
function amount(n: number, currency?: string | null): string {
  const text = formatMoney(fromFloat(Math.abs(n)))
  const sign = n < 0 ? '-' : ''
  const cur = currency?.toUpperCase()
  if (!cur || cur === 'UNKNOWN') return `${sign}${text}`
  return cur === 'USD' ? `${sign}$${text}` : `${sign}${text} ${cur}`
}

function signed(n: number, currency?: string | null): string {
  return n > 0 ? `+${amount(n, currency)}` : amount(n, currency)
}

/** "+12.5%", or null when the earlier value is zero (no meaningful percentage). */
function percentChange(before: number, after: number): string | null {
  if (before === 0) return null
  const pct = Math.round(((after - before) / Math.abs(before)) * 1000) / 10
  return `${pct > 0 ? '+' : ''}${pct}%`
}

function signedCount(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

const answered = (r: ToolResult): boolean => !r.notice && !r.error && r.data != null && typeof r.data === 'object'
const periodOf = (l: Lookup): string | undefined => l.call.dateRange?.label ?? ((l.result.data as Data)?.label as string | undefined)

const LIST_NOUNS: Partial<Record<CelestialToolName, string>> = {
  'orders.list': 'orders',
  'purchasing.orders': 'purchase orders',
  'quotes.list': 'quotes',
  'finance.bills': 'vendor bills',
}

/** The same lookup over two or more periods: changes between consecutive periods. */
function comparePeriods(lookups: Lookup[]): string | null {
  const byTool = new Map<CelestialToolName, Lookup[]>()
  for (const l of lookups) {
    if (!periodOf(l)) continue
    const list = byTool.get(l.result.name) ?? []
    list.push(l)
    byTool.set(l.result.name, list)
  }
  const sections: string[] = []
  for (const [tool, group] of byTool) {
    const periods = group.filter((l, i) => group.findIndex((o) => periodOf(o) === periodOf(l)) === i)
    if (periods.length < 2) continue
    // Oldest period first, so "change" reads forward in time.
    periods.sort((a, b) => (a.call.dateRange?.from.getTime() ?? 0) - (b.call.dateRange?.from.getTime() ?? 0))

    if (tool === 'sales.summary') {
      const rows = periods.map((l) => {
        const d = l.result.data as Data
        return { label: periodOf(l)!, orders: Number(d.totalOrders ?? 0), revenue: Number(d.totalRevenue ?? 0), partial: Boolean(d.truncated) }
      })
      const lines = [
        '### Sales comparison',
        '',
        '| Period | Orders | Revenue |',
        '| :--- | :--- | :--- |',
        ...rows.map((r) => `| ${r.label} | ${r.orders} | ${amount(r.revenue)}${r.partial ? ' (partial)' : ''} |`),
        '',
      ]
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1]
        const b = rows[i]
        if (a.partial || b.partial) {
          lines.push(`- ${a.label} → ${b.label}: not compared, because one of the totals is partial (too many orders to total).`)
          continue
        }
        const pct = percentChange(a.revenue, b.revenue)
        lines.push(
          `- ${a.label} → ${b.label}: revenue **${signed(roundMoney(b.revenue - a.revenue))}**${pct ? ` (${pct})` : ''}, orders **${signedCount(b.orders - a.orders)}**.`,
        )
      }
      lines.push('', '*Revenue is order totals as recorded; orders store no currency.*')
      sections.push(lines.join('\n'))
      continue
    }

    const noun = LIST_NOUNS[tool]
    if (!noun) continue
    const rows = periods.map((l) => {
      const d = l.result.data as Data
      return {
        label: periodOf(l)!,
        total: Number(d.total ?? 0),
        balances: tool === 'finance.bills' && !d.totalsTruncated ? (d.balanceByCurrency as Record<string, number> | undefined) : undefined,
      }
    })
    const lines = [`### ${noun[0].toUpperCase()}${noun.slice(1)} by period`, '']
    for (const r of rows) {
      const bal = r.balances
        ? Object.entries(r.balances)
            .filter(([, v]) => v !== 0)
            .map(([cur, v]) => amount(v, cur))
        : []
      lines.push(`- **${r.label}:** ${r.total} ${noun}${bal.length > 0 ? `, open balance ${bal.join(' + ')}` : ''}`)
    }
    for (let i = 1; i < rows.length; i++) {
      lines.push(`- Change ${rows[i - 1].label} → ${rows[i].label}: **${signedCount(rows[i].total - rows[i - 1].total)}** ${noun}.`)
    }
    sections.push(lines.join('\n'))
  }
  return sections.length > 0 ? sections.join('\n\n') : null
}

/** Money customers owe us next to money we owe suppliers, one row per currency. */
function compareReceivablesPayables(lookups: Lookup[]): string | null {
  const ar = lookups.find((l) => l.result.name === 'list_my_invoices' && !l.call.customer && !l.call.dateRange && !l.call.pastDue)
  const ap = lookups.find((l) => l.result.name === 'finance.bills' && !l.call.supplier && !l.call.dateRange)
  if (!ar || !ap) return null
  const lines = ['### Receivables vs payables', '']
  const missing = [ar, ap].filter((l) => !answered(l.result)).map((l) => TOOL_LABELS[l.result.name])
  if (missing.length > 0) {
    lines.push(`Not compared: ${missing.join(' and ')} could not be read for this answer.`)
    return lines.join('\n')
  }
  const arData = ar.result.data as Data
  const apData = ap.result.data as Data
  const arTotals = arData.openBalanceByCurrency as Record<string, number> | undefined
  const apTotals = apData.balanceByCurrency as Record<string, number> | undefined
  if (!arTotals || !apTotals) return null
  const currencies = [...new Set([...Object.keys(arTotals), ...Object.keys(apTotals)])].filter(
    (c) => (arTotals[c] ?? 0) !== 0 || (apTotals[c] ?? 0) !== 0,
  )
  if (currencies.length === 0) {
    lines.push('Nothing is outstanding either way: no unpaid customer invoices and no unpaid vendor bills.')
    return lines.join('\n')
  }
  const partial = Boolean(arData.totalsTruncated) || Boolean(apData.totalsTruncated)
  lines.push(
    '| Currency | Customers owe us (AR) | We owe suppliers (AP) | Net (AR − AP) |',
    '| :--- | :--- | :--- | :--- |',
    ...currencies.map((c) => {
      const a = arTotals[c] ?? 0
      const p = apTotals[c] ?? 0
      return `| ${c === 'UNKNOWN' ? 'not recorded' : c} | ${amount(a, c)} | ${amount(p, c)} | ${partial ? '—' : `**${signed(roundMoney(a - p), c)}**`} |`
    }),
    '',
    `*Open balances across every unpaid invoice (${Number(arData.openInvoices ?? 0)}) and every matching vendor bill (${Number(apData.total ?? 0)}).${currencies.length > 1 ? ' Currencies are kept separate; nothing is converted.' : ''}${partial ? ' Net not shown: one of the totals is partial (too many records to total).' : ''}*`,
  )
  return lines.join('\n')
}

/** Every row of a page when the page holds all matches; otherwise null (a sum would be partial). */
function completeRows<T>(d: Data): T[] | null {
  const rows = d.rows as T[] | undefined
  if (!Array.isArray(rows)) return null
  return Number(d.page ?? 1) === 1 && Number(d.total ?? rows.length) <= rows.length ? rows : null
}

/** One supplier's purchase orders next to its vendor bills. */
function compareSupplier(lookups: Lookup[]): string | null {
  const po = lookups.find((l) => l.result.name === 'purchasing.orders' && l.call.supplier)
  const bills = lookups.find((l) => l.result.name === 'finance.bills' && l.call.supplier === po?.call.supplier)
  if (!po || !bills) return null
  const supplier = po.call.supplier!
  const lines = [`### ${supplier}: purchase orders and bills`, '']
  const missing = [po, bills].filter((l) => !answered(l.result)).map((l) => TOOL_LABELS[l.result.name])
  if (missing.length > 0) {
    lines.push(`Not compared: ${missing.join(' and ')} could not be read for this answer.`)
    return lines.join('\n')
  }
  const poData = po.result.data as Data
  const billData = bills.result.data as Data
  lines.push(`- **Purchase orders:** ${Number(poData.total ?? 0)}`)
  const open = Object.entries((billData.balanceByCurrency as Record<string, number>) ?? {})
    .filter(([, v]) => v !== 0)
    .map(([cur, v]) => amount(v, cur))
  lines.push(
    `- **Vendor bills:** ${Number(billData.total ?? 0)}${open.length > 0 ? `, open balance ${open.join(' + ')}${billData.totalsTruncated ? ' (partial)' : ''}` : ', nothing left to pay'}`,
  )

  // Ordered vs billed only when both lists are complete and every PO line has a recorded cost.
  // Cancelled or draft POs were never ordered, and draft or void bills were never billed.
  const poRows = completeRows<{ goodsCost: number | null; currency: string; missingCostLines: number; status: string }>(poData)?.filter(
    (r) => !['CANCELLED', 'DRAFT'].includes(r.status),
  )
  const billRows = completeRows<{ totalAmount: number; currency: string; status: string }>(billData)?.filter(
    (r) => !['VOID', 'DRAFT'].includes(r.status),
  )
  if (!poRows || !billRows) {
    lines.push('- **Ordered vs billed:** not compared, because not every record fits in one answer. Open Purchasing for the full list.')
  } else if (poRows.some((r) => r.goodsCost == null)) {
    const unknown = poRows.reduce((n, r) => n + (r.goodsCost == null ? r.missingCostLines : 0), 0)
    lines.push(`- **Ordered vs billed:** not compared, because ${unknown} PO line(s) have no unit cost recorded.`)
  } else {
    const ordered: Record<string, number> = {}
    const billed: Record<string, number> = {}
    for (const r of poRows) ordered[r.currency.toUpperCase()] = roundMoney((ordered[r.currency.toUpperCase()] ?? 0) + (r.goodsCost ?? 0))
    for (const r of billRows) billed[r.currency.toUpperCase()] = roundMoney((billed[r.currency.toUpperCase()] ?? 0) + r.totalAmount)
    for (const cur of new Set([...Object.keys(ordered), ...Object.keys(billed)])) {
      const o = ordered[cur] ?? 0
      const b = billed[cur] ?? 0
      lines.push(`- **Ordered vs billed (${cur}):** goods ordered ${amount(o, cur)}, billed ${amount(b, cur)}, difference **${signed(roundMoney(o - b), cur)}**`)
    }
    lines.push('', '*Goods cost is PO lines × unit cost; bill totals can also include freight, duty and tax.*')
  }
  return lines.join('\n')
}

/** One customer's orders, quotes and unpaid invoices together. */
function compareCustomer(lookups: Lookup[]): string | null {
  const related = lookups.filter((l) => ['orders.list', 'list_my_invoices', 'quotes.list'].includes(l.result.name) && l.call.customer)
  const customer = related[0]?.call.customer
  const same = related.filter((l) => l.call.customer === customer)
  if (!customer || new Set(same.map((l) => l.result.name)).size < 2) return null
  // Nothing to compare (for example no such customer); the lookups' own notices say why.
  if (!same.some((l) => answered(l.result))) return null
  const lines = [`### ${customer} at a glance`, '']
  for (const l of same) {
    if (!answered(l.result)) {
      lines.push(`- **${TOOL_LABELS[l.result.name]}:** could not be read for this answer.`)
      continue
    }
    const d = l.result.data as Data
    if (l.result.name === 'list_my_invoices') {
      const open = Object.entries((d.openBalanceByCurrency as Record<string, number>) ?? {})
        .filter(([, v]) => v !== 0)
        .map(([cur, v]) => amount(v, cur))
      lines.push(
        `- **Unpaid invoices:** ${Number(d.openInvoices ?? 0)}${open.length > 0 ? `, still owed ${open.join(' + ')}${d.totalsTruncated ? ' (partial)' : ''}` : ''}`,
      )
    } else {
      lines.push(`- **${l.result.name === 'orders.list' ? 'Orders' : 'Quotes'}:** ${Number(d.total ?? 0)}`)
    }
  }
  return lines.join('\n')
}

/**
 * The server-built comparison for a multi-lookup answer, shown above the record tables, or null
 * when the lookups aren't related in a way this module compares.
 */
export function analyzeLookups(calls: DetectedIntent[], perCall: ToolResult[][]): string | null {
  // One lookup per tool result. A keyword match can run two tools under the same settings
  // ("receivables and payables"); a list that turned into one record ("the latest PO") comes back
  // under the detail tool's name and drops out of the list comparisons.
  const lookups: Lookup[] = calls.flatMap((call, i) =>
    (perCall[i] ?? []).filter((result) => call.tools.includes(result.name)).map((result) => ({ call, result })),
  )
  if (lookups.length < 2) return null
  const periods = comparePeriods(lookups.filter((l) => answered(l.result)))
  const sections = [periods, compareReceivablesPayables(lookups), compareSupplier(lookups), compareCustomer(lookups)].filter(
    (s): s is string => Boolean(s),
  )
  return sections.length > 0 ? sections.join('\n\n') : null
}
