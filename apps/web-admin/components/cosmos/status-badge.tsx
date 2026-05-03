'use client'

export const STATUS_COLORS: Record<string, string> = {
  PENDING: '#F59E0B',
  CONFIRMED: '#6366F1',
  FULFILLED: '#10B981',
  PROCESSING: '#6366F1',
  SHIPPED: '#22D3EE',
  DELIVERED: '#10B981',
  CANCELLED: '#EF4444',
  FAILED: '#EF4444',
  RETURNED: '#F59E0B',
  DRAFT: '#64748B',
  PENDING_APPROVAL: '#F59E0B',
  APPROVED: '#6366F1',
  SENT: '#22D3EE',
  PARTIALLY_RECEIVED: '#F59E0B',
  RECEIVED: '#10B981',
  CLOSED: '#10B981',
  GENERATED: '#F59E0B',
  SUBMITTED: '#10B981',
  SUBMISSION_FAILED: '#EF4444',
  ISSUED: '#6366F1',
  OVERDUE: '#EF4444',
  PAID: '#10B981',
  POSTED: '#10B981',
  ASSET: '#6366F1',
  LIABILITY: '#F59E0B',
  EQUITY: '#A855F7',
  REVENUE: '#10B981',
  EXPENSE: '#EF4444',
  SHORT: '#F59E0B',
  PARTIALLY_PAID: '#F59E0B',
  VOIDED: '#64748B',
  PICKING: '#6366F1',
  PICKED: '#22D3EE',
  PACKING: '#F59E0B',
  PACKED: '#10B981',
  DISPATCHED: '#10B981',
  ACTIVE: '#10B981',
  INACTIVE: '#64748B',
  OPEN: '#6366F1',
  COMPLETED: '#10B981',
  DISCREPANCY: '#EF4444',
  IN_PROGRESS: '#F59E0B',
  SEE_COMPLIANCE: '#22D3EE',
  NO_DATA: '#64748B',
  PLANNED: '#6366F1',
  EN_ROUTE: '#22D3EE',
  EMAIL: '#6366F1',
  SMS: '#22D3EE',
  PUSH: '#A855F7',
  ACCEPTED: '#10B981',
  CONVERTED: '#10B981',
  LOST: '#64748B',
}

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#64748B'
  const label = status.replace(/_/g, ' ')
  return (
    <span
      className="inline-flex items-center gap-1.5 uppercase"
      style={{
        padding: '3px 10px',
        borderRadius: 20,
        background: `${color}20`,
        border: `1px solid ${color}40`,
        color,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'var(--font-body)',
        letterSpacing: '0.02em',
      }}
    >
      <span className="rounded-full w-1.5 h-1.5 shrink-0" style={{ background: color }} />
      {label}
    </span>
  )
}
