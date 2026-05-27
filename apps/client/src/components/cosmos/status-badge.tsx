const STATUS: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: 'var(--c-warning-soft)', text: 'var(--c-warning)' },
  CONFIRMED: { bg: 'var(--c-accent-dim)', text: 'var(--c-primary)' },
  FULFILLED: { bg: 'var(--c-success-soft)', text: 'var(--c-success)' },
  PROCESSING: { bg: 'var(--c-accent-dim)', text: 'var(--c-primary)' },
  SHIPPED: { bg: 'var(--c-accent-dim)', text: 'var(--c-accent)' },
  DELIVERED: { bg: 'var(--c-success-soft)', text: 'var(--c-success)' },
  RETURNED: { bg: 'var(--c-warning-soft)', text: 'var(--c-warning)' },
  CANCELLED: { bg: 'var(--c-danger-soft)', text: 'var(--c-danger)' },
  FAILED: { bg: 'var(--c-danger-soft)', text: 'var(--c-danger)' },
  DRAFT: { bg: 'var(--c-surface-2)', text: 'var(--c-text-3)' },
  GENERATED: { bg: 'var(--c-warning-soft)', text: 'var(--c-warning)' },
  SUBMITTED: { bg: 'var(--c-success-soft)', text: 'var(--c-success)' },
  SUBMISSION_FAILED: { bg: 'var(--c-danger-soft)', text: 'var(--c-danger)' },
  SEE_COMPLIANCE: { bg: 'var(--c-accent-dim)', text: 'var(--c-primary)' },
  OPEN: { bg: 'var(--c-surface-2)', text: 'var(--c-text-3)' },
  IN_PROGRESS: { bg: 'var(--c-warning-soft)', text: 'var(--c-warning)' },
  COMPLETED: { bg: 'var(--c-success-soft)', text: 'var(--c-success)' },
  WON: { bg: 'var(--c-success-soft)', text: 'var(--c-success)' },
  LOST: { bg: 'var(--c-danger-soft)', text: 'var(--c-danger)' },
  NEW: { bg: 'var(--c-surface-2)', text: 'var(--c-text-3)' },
  ISSUED: { bg: 'var(--c-accent-dim)', text: 'var(--c-primary)' },
  PARTIALLY_PAID: { bg: 'var(--c-warning-soft)', text: 'var(--c-warning)' },
  PAID: { bg: 'var(--c-success-soft)', text: 'var(--c-success)' },
  OVERDUE: { bg: 'var(--c-danger-soft)', text: 'var(--c-danger)' },
  CREDITED: { bg: 'var(--c-surface-2)', text: 'var(--c-text-2)' },
  VOID: { bg: 'var(--c-surface-2)', text: 'var(--c-text-3)' },
}

export function StatusBadge({ status }: { status: string }) {
  const palette = STATUS[status] ?? { bg: 'var(--c-surface-2)', text: 'var(--c-text-3)' }
  const label = status.replace(/_/g, ' ')
  return (
    <span
      className="inline-flex items-center uppercase"
      style={{
        padding: '4px 10px',
        borderRadius: 6,
        background: palette.bg,
        color: palette.text,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.05em',
        border: '1px solid var(--c-border-card)',
      }}
    >
      {label}
    </span>
  )
}
