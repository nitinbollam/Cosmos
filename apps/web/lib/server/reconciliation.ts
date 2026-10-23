import { Prisma as LedgerPrisma } from '@/generated/prisma-ledger'
import { analyticsDb, crmDb, inventoryDb, ledgerDb, orderDb, paymentDb, wmsDb } from './db'
import { netTermsExposure } from './credit-limit'

/**
 * PLR-150: cross-database reconciliation.
 *
 * Pleros keeps 16 separate databases, so no transaction can span a business operation. This job
 * scans a tenant for violations of invariants that must always hold, and records them in
 * ReconciliationFinding. It is READ-ONLY with respect to business data: the only table it writes is
 * ReconciliationFinding (analytics DB).
 */

export type RuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10'

export type Finding = {
  ruleId: RuleId
  entityType: string
  entityId: string
  details: Record<string, unknown>
}

export const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  R1: 'Order SHIPPED/DELIVERED with no invoice',
  R2: 'Invoice older than 15 minutes with no posted journal entry',
  R3: 'Journal entry whose debits do not equal credits',
  R4: 'Stock level disagrees with its ledger or with on-hand minus reserved',
  R5: 'Stock level reserved quantity differs from the sum of ACTIVE reservations',
  R6: 'ACTIVE reservation belonging to a cancelled, failed or fully shipped order',
  R7: 'Order amountPaid differs from captured minus refunded payments',
  R8: 'Open invoice balances differ from the ledger balance of account 1200',
  R9: 'Fulfilment task state contradicts the order state or its reservations',
  R10: 'Customer credit used differs from open NET_TERMS exposure',
}

/** New findings for these rules raise an alert. */
export const ALERT_RULES: RuleId[] = ['R1', 'R2', 'R3']

const INVOICE_GRACE_MS = 15 * 60 * 1000
const CHUNK = 500
const MONEY_TOLERANCE = new LedgerPrisma.Decimal('0.01')

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const D = (v: unknown) => new LedgerPrisma.Decimal(v === null || v === undefined ? '0' : String(v))
const batchKey = (b: string | null | undefined) => b ?? ''

export type RuleContext = { tenantId: string; now: Date }
type Rule = (ctx: RuleContext) => Promise<Finding[]>

/** R1: shipped/delivered orders must have an invoice (zero-value orders excluded). */
export const ruleR1: Rule = async ({ tenantId }) => {
  const orders = await orderDb.order.findMany({
    where: { tenantId, status: { in: ['SHIPPED', 'DELIVERED'] }, invoice: null, totalAmount: { gt: 0 } },
    select: { id: true, status: true, totalAmount: true },
  })
  return orders.map((o) => ({
    ruleId: 'R1' as const,
    entityType: 'ORDER',
    entityId: o.id,
    details: { status: o.status, totalAmount: o.totalAmount.toString() },
  }))
}

/** R2: an invoice past the grace period must reference a journal entry that exists. */
export const ruleR2: Rule = async ({ tenantId, now }) => {
  const cutoff = new Date(now.getTime() - INVOICE_GRACE_MS)
  const invoices = await orderDb.invoice.findMany({
    where: { tenantId, issuedAt: { lt: cutoff }, status: { not: 'VOID' } },
    select: { id: true, invoiceNumber: true, journalEntryId: true, totalAmount: true },
  })
  const withEntry = invoices.filter((i) => i.journalEntryId)
  const existing = new Set<string>()
  for (const part of chunks(withEntry.map((i) => i.journalEntryId as string))) {
    const rows = await ledgerDb.journalEntry.findMany({
      where: { tenantId, id: { in: part } },
      select: { id: true },
    })
    rows.forEach((r) => existing.add(r.id))
  }
  const missing = invoices.filter((i) => !i.journalEntryId || !existing.has(i.journalEntryId))

  // Say why: a queued, retrying or dead posting job, or none at all (the invoice predates the outbox).
  const jobs = new Map<string, { status: string; attempts: number; lastError: string | null }>()
  for (const part of chunks(missing.map((i) => i.id))) {
    const rows = await orderDb.postingJob.findMany({
      where: { tenantId, kind: 'INVOICE_JOURNAL', sourceType: 'Invoice', sourceId: { in: part } },
      select: { sourceId: true, status: true, attempts: true, lastError: true },
    })
    rows.forEach((r) => jobs.set(r.sourceId, { status: r.status, attempts: r.attempts, lastError: r.lastError }))
  }
  const reasonFor = (i: (typeof missing)[number]) => {
    if (i.journalEntryId) return 'journal entry not found'
    const job = jobs.get(i.id)
    if (!job) return 'no posting job queued (invoice predates the outbox)'
    if (job.status === 'DEAD') return `posting job is DEAD after ${job.attempts} attempts`
    if (job.status === 'DONE') return 'posting job finished but the invoice has no journal entry linked'
    return `posting job ${job.status.toLowerCase()} (attempt ${job.attempts})`
  }

  return missing.map((i) => ({
    ruleId: 'R2' as const,
    entityType: 'INVOICE',
    entityId: i.id,
    details: {
      invoiceNumber: i.invoiceNumber,
      totalAmount: i.totalAmount.toString(),
      journalEntryId: i.journalEntryId,
      reason: reasonFor(i),
      postingJob: jobs.get(i.id) ?? null,
    },
  }))
}

/** R3: every journal entry must balance. */
export const ruleR3: Rule = async ({ tenantId }) => {
  const sums = await ledgerDb.journalLine.groupBy({
    by: ['entryId'],
    where: { entry: { tenantId } },
    _sum: { debit: true, credit: true },
  })
  return sums
    .filter((s) => !D(s._sum.debit).eq(D(s._sum.credit)))
    .map((s) => ({
      ruleId: 'R3' as const,
      entityType: 'JOURNAL_ENTRY',
      entityId: s.entryId,
      details: { debits: D(s._sum.debit).toString(), credits: D(s._sum.credit).toString() },
    }))
}

/** R4: ledger deltas must add up to on-hand; available must equal on-hand minus reserved. */
export const ruleR4: Rule = async ({ tenantId }) => {
  const [levels, ledger] = await Promise.all([
    inventoryDb.stockLevel.findMany({ where: { tenantId } }),
    inventoryDb.stockLedgerEntry.groupBy({
      by: ['skuId', 'warehouseId', 'batchId'],
      where: { tenantId },
      _sum: { quantityDelta: true },
    }),
  ])
  const ledgerSum = new Map<string, number>()
  for (const l of ledger) {
    const k = `${l.skuId}|${l.warehouseId}|${batchKey(l.batchId)}`
    ledgerSum.set(k, (ledgerSum.get(k) ?? 0) + (l._sum.quantityDelta ?? 0))
  }
  const out: Finding[] = []
  for (const lv of levels) {
    const k = `${lv.skuId}|${lv.warehouseId}|${batchKey(lv.batchId)}`
    const sum = ledgerSum.get(k) ?? 0
    const expectedAvailable = lv.quantityOnHand - lv.quantityReserved
    const problems: string[] = []
    if (sum !== lv.quantityOnHand) problems.push('ledger sum differs from on-hand')
    if (lv.quantityAvailable !== expectedAvailable) problems.push('available differs from on-hand minus reserved')
    if (problems.length) {
      out.push({
        ruleId: 'R4',
        entityType: 'STOCK_LEVEL',
        entityId: lv.id,
        details: {
          skuId: lv.skuId,
          warehouseId: lv.warehouseId,
          onHand: lv.quantityOnHand,
          reserved: lv.quantityReserved,
          available: lv.quantityAvailable,
          ledgerSum: sum,
          problems,
        },
      })
    }
  }
  return out
}

/** R5: reserved quantity on a stock level equals the sum of its ACTIVE reservations. */
export const ruleR5: Rule = async ({ tenantId }) => {
  const [levels, active] = await Promise.all([
    inventoryDb.stockLevel.findMany({ where: { tenantId } }),
    inventoryDb.stockReservation.groupBy({
      by: ['skuId', 'warehouseId', 'batchId'],
      where: { tenantId, status: 'ACTIVE' },
      _sum: { quantity: true },
    }),
  ])
  const reservedBy = new Map<string, number>()
  for (const r of active) {
    const k = `${r.skuId}|${r.warehouseId}|${batchKey(r.batchId)}`
    reservedBy.set(k, (reservedBy.get(k) ?? 0) + (r._sum.quantity ?? 0))
  }
  const seen = new Set<string>()
  const out: Finding[] = []
  for (const lv of levels) {
    const k = `${lv.skuId}|${lv.warehouseId}|${batchKey(lv.batchId)}`
    seen.add(k)
    const sum = reservedBy.get(k) ?? 0
    if (sum !== lv.quantityReserved) {
      out.push({
        ruleId: 'R5',
        entityType: 'STOCK_LEVEL',
        entityId: lv.id,
        details: { skuId: lv.skuId, warehouseId: lv.warehouseId, reserved: lv.quantityReserved, activeReservations: sum },
      })
    }
  }
  // ACTIVE reservations with no stock level row at all.
  for (const [k, sum] of reservedBy) {
    if (!seen.has(k) && sum > 0) {
      const [skuId, warehouseId, batch] = k.split('|')
      out.push({
        ruleId: 'R5',
        entityType: 'STOCK_LEVEL_MISSING',
        entityId: k,
        details: { skuId, warehouseId, batchId: batch, activeReservations: sum },
      })
    }
  }
  return out
}

/** R6: an ACTIVE reservation must belong to a live (not cancelled/failed/shipped) order. */
export const ruleR6: Rule = async ({ tenantId }) => {
  const active = await inventoryDb.stockReservation.findMany({
    where: { tenantId, status: 'ACTIVE' },
    select: { id: true, orderId: true, skuId: true, quantity: true },
  })
  const orderIds = [...new Set(active.map((r) => r.orderId))]
  const status = new Map<string, string>()
  for (const part of chunks(orderIds)) {
    const orders = await orderDb.order.findMany({
      where: { tenantId, id: { in: part } },
      select: { id: true, status: true },
    })
    orders.forEach((o) => status.set(o.id, o.status))
  }
  const dead = new Set(['CANCELLED', 'FAILED', 'SHIPPED', 'DELIVERED', 'RETURNED'])
  return active
    .filter((r) => dead.has(status.get(r.orderId) ?? ''))
    .map((r) => ({
      ruleId: 'R6' as const,
      entityType: 'RESERVATION',
      entityId: r.id,
      details: { orderId: r.orderId, orderStatus: status.get(r.orderId), skuId: r.skuId, quantity: r.quantity },
    }))
}

/** R7: amountPaid on an order equals captured minus refunded across its payment intents. */
export const ruleR7: Rule = async ({ tenantId }) => {
  const intents = await paymentDb.paymentIntent.findMany({
    where: { tenantId },
    select: { orderId: true, capturedAmount: true, refundedAmount: true },
  })
  const net = new Map<string, InstanceType<typeof LedgerPrisma.Decimal>>()
  for (const p of intents) {
    net.set(p.orderId, (net.get(p.orderId) ?? D(0)).add(D(p.capturedAmount)).sub(D(p.refundedAmount)))
  }
  const out: Finding[] = []
  for (const part of chunks([...net.keys()])) {
    const orders = await orderDb.order.findMany({
      where: { tenantId, id: { in: part } },
      select: { id: true, amountPaid: true },
    })
    for (const o of orders) {
      const expected = net.get(o.id) ?? D(0)
      if (D(o.amountPaid).sub(expected).abs().gte(MONEY_TOLERANCE)) {
        out.push({
          ruleId: 'R7',
          entityType: 'ORDER',
          entityId: o.id,
          details: { amountPaid: D(o.amountPaid).toString(), capturedMinusRefunded: expected.toString() },
        })
      }
    }
  }
  return out
}

/** R8: sum of open invoice balances (base currency) equals the ledger balance of account 1200. */
export const ruleR8: Rule = async ({ tenantId }) => {
  const invoices = await orderDb.invoice.findMany({
    where: { tenantId, status: { notIn: ['VOID'] }, order: { status: { notIn: ['CANCELLED', 'FAILED'] } } },
    select: { totalAmount: true, amountPaid: true, amountCredited: true, fxRateToBase: true },
  })
  let open = D(0)
  for (const i of invoices) {
    const balance = D(i.totalAmount).sub(D(i.amountPaid)).sub(D(i.amountCredited))
    if (balance.gt(0)) open = open.add(balance.mul(D(i.fxRateToBase)))
  }
  const account = await ledgerDb.chartAccount.findFirst({ where: { tenantId, code: '1200' }, select: { id: true } })
  if (!account) {
    return open.gt(0)
      ? [{ ruleId: 'R8', entityType: 'TENANT', entityId: tenantId, details: { reason: 'account 1200 missing', openInvoices: open.toFixed(2) } }]
      : []
  }
  const agg = await ledgerDb.journalLine.aggregate({
    where: { accountId: account.id, entry: { tenantId } },
    _sum: { debit: true, credit: true },
  })
  const ledgerBalance = D(agg._sum.debit).sub(D(agg._sum.credit))
  if (ledgerBalance.sub(open).abs().gte(MONEY_TOLERANCE)) {
    return [
      {
        ruleId: 'R8',
        entityType: 'TENANT',
        entityId: tenantId,
        details: {
          openInvoices: open.toFixed(2),
          ledger1200: ledgerBalance.toFixed(2),
          difference: ledgerBalance.sub(open).toFixed(2),
        },
      },
    ]
  }
  return []
}

/** R9: dispatched tasks need a shipped order; packed tasks need live reservations. */
export const ruleR9: Rule = async ({ tenantId }) => {
  const tasks = await wmsDb.fulfillmentTask.findMany({
    where: { tenantId, status: { in: ['DISPATCHED', 'PACKED'] } },
    select: { id: true, orderId: true, status: true },
  })
  const orderIds = [...new Set(tasks.map((t) => t.orderId))]
  const orderStatus = new Map<string, string>()
  const activeByOrder = new Set<string>()
  for (const part of chunks(orderIds)) {
    const orders = await orderDb.order.findMany({ where: { tenantId, id: { in: part } }, select: { id: true, status: true } })
    orders.forEach((o) => orderStatus.set(o.id, o.status))
    const res = await inventoryDb.stockReservation.findMany({
      where: { tenantId, orderId: { in: part }, status: 'ACTIVE' },
      select: { orderId: true },
      distinct: ['orderId'],
    })
    res.forEach((r) => activeByOrder.add(r.orderId))
  }
  const out: Finding[] = []
  for (const t of tasks) {
    const st = orderStatus.get(t.orderId)
    if (t.status === 'DISPATCHED' && st !== 'SHIPPED' && st !== 'DELIVERED') {
      out.push({
        ruleId: 'R9',
        entityType: 'FULFILLMENT_TASK',
        entityId: t.id,
        details: { orderId: t.orderId, taskStatus: t.status, orderStatus: st ?? 'MISSING', reason: 'dispatched but order not shipped' },
      })
    }
    if (t.status === 'PACKED' && !activeByOrder.has(t.orderId)) {
      out.push({
        ruleId: 'R9',
        entityType: 'FULFILLMENT_TASK',
        entityId: t.id,
        details: { orderId: t.orderId, taskStatus: t.status, orderStatus: st ?? 'MISSING', reason: 'packed with no active reservations' },
      })
    }
  }
  return out
}

/** R10: customer.creditUsed equals the open NET_TERMS exposure of the customer's live orders. */
export const ruleR10: Rule = async ({ tenantId }) => {
  const orders = await orderDb.order.findMany({
    where: {
      tenantId,
      paymentMethod: 'NET_TERMS',
      status: { in: ['CONFIRMED', 'BACKORDERED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'] },
    },
    select: { customerId: true, totalAmount: true, amountPaid: true },
  })
  const exposure = new Map<string, number>()
  for (const o of orders) {
    exposure.set(
      o.customerId,
      (exposure.get(o.customerId) ?? 0) + netTermsExposure(Number(o.totalAmount), Number(o.amountPaid)),
    )
  }
  const customers = await crmDb.customer.findMany({ where: { tenantId }, select: { id: true, creditUsed: true } })
  const out: Finding[] = []
  for (const c of customers) {
    const expected = Math.round((exposure.get(c.id) ?? 0) * 100) / 100
    const used = Math.round(Number(c.creditUsed ?? 0) * 100) / 100
    if (Math.abs(used - expected) >= 0.01) {
      out.push({
        ruleId: 'R10',
        entityType: 'CUSTOMER',
        entityId: c.id,
        details: { creditUsed: used, openNetTermsExposure: expected, difference: +(used - expected).toFixed(2) },
      })
    }
  }
  return out
}

export const RULES: Record<RuleId, Rule> = {
  R1: ruleR1,
  R2: ruleR2,
  R3: ruleR3,
  R4: ruleR4,
  R5: ruleR5,
  R6: ruleR6,
  R7: ruleR7,
  R8: ruleR8,
  R9: ruleR9,
  R10: ruleR10,
}

export type ReconcileResult = {
  tenantId: string
  dryRun: boolean
  findings: Finding[]
  byRule: Record<RuleId, number>
  newFindings: Finding[]
  resolved: number
  ruleErrors: Partial<Record<RuleId, string>>
}

const findingKey = (f: { ruleId: string; entityType: string; entityId: string }) =>
  `${f.ruleId}|${f.entityType}|${f.entityId}`

/**
 * Run all (or selected) rules for a tenant. Unless dryRun, upserts findings (refreshing lastSeenAt,
 * reopening resolved ones) and marks previously open findings that no longer reproduce as resolved.
 * A rule that throws is reported in ruleErrors and its existing findings are left untouched.
 */
export async function runReconciliation(
  tenantId: string,
  opts: { dryRun?: boolean; rules?: RuleId[]; now?: Date } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun ?? false
  const ruleIds = opts.rules ?? (Object.keys(RULES) as RuleId[])
  const byRule = Object.fromEntries((Object.keys(RULES) as RuleId[]).map((r) => [r, 0])) as Record<RuleId, number>
  const ruleErrors: Partial<Record<RuleId, string>> = {}
  const findings: Finding[] = []
  const completed: RuleId[] = []

  for (const id of ruleIds) {
    try {
      const found = await RULES[id]({ tenantId, now })
      findings.push(...found)
      byRule[id] = found.length
      completed.push(id)
    } catch (err) {
      ruleErrors[id] = err instanceof Error ? err.message : String(err)
    }
  }

  const newFindings: Finding[] = []
  let resolved = 0
  if (!dryRun) {
    const existing = await analyticsDb.reconciliationFinding.findMany({
      where: { tenantId, ruleId: { in: completed } },
      select: { id: true, ruleId: true, entityType: true, entityId: true, resolvedAt: true },
    })
    const byKey = new Map(existing.map((e) => [findingKey(e), e]))
    const stillOpen = new Set<string>()
    for (const f of findings) {
      const key = findingKey(f)
      stillOpen.add(key)
      const prev = byKey.get(key)
      if (!prev) {
        newFindings.push(f)
        await analyticsDb.reconciliationFinding.create({
          data: { tenantId, ruleId: f.ruleId, entityType: f.entityType, entityId: f.entityId, details: f.details as never, firstSeenAt: now, lastSeenAt: now },
        })
      } else {
        if (prev.resolvedAt) newFindings.push(f)
        await analyticsDb.reconciliationFinding.update({
          where: { id: prev.id },
          data: { details: f.details as never, lastSeenAt: now, resolvedAt: null },
        })
      }
    }
    const toResolve = existing.filter((e) => !e.resolvedAt && !stillOpen.has(findingKey(e))).map((e) => e.id)
    for (const part of chunks(toResolve)) {
      await analyticsDb.reconciliationFinding.updateMany({ where: { id: { in: part } }, data: { resolvedAt: now } })
    }
    resolved = toResolve.length
  }

  return { tenantId, dryRun, findings, byRule, newFindings, resolved, ruleErrors }
}

/** Emit one metric line per rule, and an alert line for new R1-R3 findings. */
export function reportReconciliation(result: ReconcileResult): void {
  for (const [rule, count] of Object.entries(result.byRule)) {
    console.log(`[metric] reconciliation_findings{tenant="${result.tenantId}",rule="${rule}"} ${count}`)
  }
  for (const rule of ALERT_RULES) {
    const fresh = result.newFindings.filter((f) => f.ruleId === rule)
    if (fresh.length > 0) {
      console.error(
        `[ALERT][reconciliation] tenant ${result.tenantId}: ${fresh.length} new ${rule} finding(s) - ${RULE_DESCRIPTIONS[rule]}`,
      )
    }
  }
  for (const [rule, msg] of Object.entries(result.ruleErrors)) {
    console.error(`[reconciliation] rule ${rule} failed for tenant ${result.tenantId}: ${msg}`)
  }
}

export async function listOpenFindings(tenantId: string, opts: { ruleId?: string; limit?: number } = {}) {
  const [rows, counts] = await Promise.all([
    analyticsDb.reconciliationFinding.findMany({
      where: { tenantId, resolvedAt: null, ...(opts.ruleId ? { ruleId: opts.ruleId } : {}) },
      orderBy: [{ ruleId: 'asc' }, { lastSeenAt: 'desc' }],
      take: Math.min(opts.limit ?? 200, 1000),
    }),
    analyticsDb.reconciliationFinding.groupBy({
      by: ['ruleId'],
      where: { tenantId, resolvedAt: null },
      _count: true,
    }),
  ])
  return {
    findings: rows,
    countsByRule: Object.fromEntries(counts.map((c) => [c.ruleId, c._count])),
    rules: RULE_DESCRIPTIONS,
  }
}

/** Nightly entry point: every tenant that has at least one order or invoice. */
export async function runReconciliationForAllTenants(): Promise<ReconcileResult[]> {
  const { tenantDb } = await import('./db')
  const tenants = await tenantDb.tenantOrganization.findMany({ select: { id: true } })
  const results: ReconcileResult[] = []
  for (const t of tenants) {
    const result = await runReconciliation(t.id)
    reportReconciliation(result)
    results.push(result)
  }
  return results
}
