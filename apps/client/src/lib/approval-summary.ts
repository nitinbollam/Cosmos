import { money } from '@/lib/rep-app'
import { formatAmount } from '@/lib/decimal-amount'

export type ApprovalRow = {
  id: string
  type: string
  subjectId: string
  status: string
  context?: Record<string, unknown> | null
  createdAt: string
  requestedBy?: string
}

/**
 * The viewer raised this requisition, so they may not decide it: someone else approves, and to change it they withdraw
 * it from the requisition page. (Other approval types keep their existing behaviour.)
 */
export function isOwnRequisition(a: ApprovalRow, userId: string | null | undefined): boolean {
  return a.type === 'PURCHASE_REQUISITION' && !!userId && a.requestedBy === userId
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export const TYPE_LABEL: Record<string, string> = {
  PURCHASE_ORDER: 'Purchase order',
  DISCOUNT: 'Discount',
  CREDIT_LIMIT_OVERRIDE: 'Order over credit limit',
  CREDIT_LIMIT_INCREASE: 'Credit limit increase',
  EXPENSE_REPORT: 'Expense report',
  PURCHASE_REQUISITION: 'Purchase requisition',
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
  if (a.type === 'PURCHASE_REQUISITION') {
    // The total is an exact decimal string; it is never turned into a float.
    const exact = str(c.total)
    const total = exact ? formatAmount(exact, str(c.currency) ?? 'USD') : null
    return { title: [title, str(c.number)].filter(Boolean).join(' '), detail: [total, str(c.supplierName)].filter(Boolean).join(' · ') }
  }
  const total = num(c.total) ?? num(c.totalAmount) ?? num(c.amount)
  const note = str(c.reason) ?? str(c.note) ?? str(c.supplierName) ?? str(c.customerName)
  return { title, detail: [total != null ? money(total) : null, note].filter(Boolean).join(' · ') }
}
