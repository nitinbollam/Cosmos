'use client'

const STATUS: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#fffbeb', text: '#b45309' },
  CONFIRMED: { bg: '#f1f5f9', text: '#475569' },
  FULFILLED: { bg: '#ecfdf5', text: '#059669' },
  PROCESSING: { bg: '#eef2ff', text: '#4f46e5' },
  SHIPPED: { bg: '#eef2ff', text: '#4f46e5' },
  DELIVERED: { bg: '#ecfdf5', text: '#059669' },
  CANCELLED: { bg: '#fef2f2', text: '#dc2626' },
  FAILED: { bg: '#fef2f2', text: '#dc2626' },
  DRAFT: { bg: '#f8fafc', text: '#64748b' },
  GENERATED: { bg: '#fffbeb', text: '#b45309' },
  SUBMITTED: { bg: '#ecfdf5', text: '#059669' },
  SUBMISSION_FAILED: { bg: '#fef2f2', text: '#dc2626' },
  SEE_COMPLIANCE: { bg: '#eef2ff', text: '#4f46e5' },
  OPEN: { bg: '#f1f5f9', text: '#475569' },
  IN_PROGRESS: { bg: '#fffbeb', text: '#b45309' },
  COMPLETED: { bg: '#ecfdf5', text: '#059669' },
  WON: { bg: '#ecfdf5', text: '#059669' },
  LOST: { bg: '#fef2f2', text: '#dc2626' },
  NEW: { bg: '#f8fafc', text: '#64748b' },
}

export function StatusBadge({ status }: { status: string }) {
  const palette = STATUS[status] ?? { bg: '#f1f5f9', text: '#64748b' }
  const label = status.replace(/_/g, ' ')
  return (
    <span
      className="inline-flex items-center uppercase"
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: palette.bg,
        color: palette.text,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.05em',
      }}
    >
      {label}
    </span>
  )
}
