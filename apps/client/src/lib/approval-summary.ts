import { money } from '@/lib/rep-app'

export type ApprovalRow = {
  id: string
  type: string
  subjectId: string
  status: string
  context?: Record<string, unknown> | null
  createdAt: string
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export const TYPE_LABEL: Record<string, string> = {
  PURCHASE_ORDER: 'Purchase order',
  DISCOUNT: 'Discount',
  CREDIT_LIMIT_OVERRIDE: 'Order over credit limit',
  CREDIT_LIMIT_INCREASE: 'Credit limit increase',
  EXPENSE_REPORT: 'Expense report',
}

/** A title and one line of detail, enough to decide from a phone. */
export function approvalSummary(a: ApprovalRow): { title: string; detail: string } {
  const c = a.context ?? {}
  const title = TYPE_LABEL[a.type] ?? a.type.replace(/_/g, ' ').toLowerCase()
  if (a.type === 'CREDIT_LIMIT_INCREASE') {
    const who = str(c.customerName) ?? 'Customer'
    const from = num(c.currentLimit)
    const to = num(c.requestedLimit)
    const move = to != null ? `${from != null ? money(from) : 'no limit'} to ${money(to)}` : ''
    return { title: `${title}: ${who}`, detail: [move, str(c.reason)].filter(Boolean).join('. ') }
  }
  const total = num(c.total) ?? num(c.totalAmount) ?? num(c.amount)
  const note = str(c.reason) ?? str(c.note) ?? str(c.supplierName) ?? str(c.customerName)
  return { title, detail: [total != null ? money(total) : null, note].filter(Boolean).join(' · ') }
}
