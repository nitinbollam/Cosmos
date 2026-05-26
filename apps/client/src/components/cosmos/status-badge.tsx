const STATUS: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#fff5e1', text: '#b45309' },
  CONFIRMED: { bg: '#fff5e1', text: '#1a202c' },
  FULFILLED: { bg: '#fff5e1', text: '#059669' },
  PROCESSING: { bg: '#fff5e1', text: '#1a202c' },
  SHIPPED: { bg: '#fff5e1', text: '#1a202c' },
  DELIVERED: { bg: '#fff5e1', text: '#059669' },
  CANCELLED: { bg: '#fff5e1', text: '#dc2626' },
  FAILED: { bg: '#fff5e1', text: '#dc2626' },
  DRAFT: { bg: '#fff5e1', text: '#718096' },
  GENERATED: { bg: '#fff5e1', text: '#b45309' },
  SUBMITTED: { bg: '#fff5e1', text: '#059669' },
  SUBMISSION_FAILED: { bg: '#fff5e1', text: '#dc2626' },
  SEE_COMPLIANCE: { bg: '#fff5e1', text: '#1a202c' },
  OPEN: { bg: '#fff5e1', text: '#718096' },
  IN_PROGRESS: { bg: '#fff5e1', text: '#b45309' },
  COMPLETED: { bg: '#fff5e1', text: '#059669' },
  WON: { bg: '#fff5e1', text: '#059669' },
  LOST: { bg: '#fff5e1', text: '#dc2626' },
  NEW: { bg: '#fff5e1', text: '#718096' },
}

export function StatusBadge({ status }: { status: string }) {
  const palette = STATUS[status] ?? { bg: '#fff5e1', text: '#718096' }
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
        border: '1px solid #1a202c',
      }}
    >
      {label}
    </span>
  )
}
