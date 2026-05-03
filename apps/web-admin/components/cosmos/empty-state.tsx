export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="text-center px-6 py-14">
      <div className="text-5xl mb-4">{icon}</div>
      <p
        className="mb-2 text-base font-semibold"
        style={{ color: 'var(--c-text)', fontFamily: 'var(--font-display)' }}
      >
        {title}
      </p>
      <p className="mb-6 text-sm" style={{ color: 'var(--c-text-3)', fontFamily: 'var(--font-body)' }}>
        {description}
      </p>
      {action}
    </div>
  )
}
