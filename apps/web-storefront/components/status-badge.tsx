'use client'

const COLORS: Record<string, string> = {
  PENDING: '#F59E0B',
  CONFIRMED: '#6366F1',
  FULFILLED: '#10B981',
  SHIPPED: '#22D3EE',
  DELIVERED: '#10B981',
  CANCELLED: '#EF4444',
  FAILED: '#EF4444',
  PROCESSING: '#6366F1',
}

export function StatusBadge({ status }: { status: string }) {
  const color = COLORS[status] ?? '#64748B'
  return (
    <span
      className="uppercase"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 20,
        background: `${color}20`,
        border: `1px solid ${color}40`,
        color,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'var(--font-body)',
        letterSpacing: '0.02em',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {status.replace(/_/g, ' ')}
    </span>
  )
}
