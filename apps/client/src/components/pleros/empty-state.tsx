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
    <div className="text-center px-4 py-10">
      <div
        className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl text-lg"
        style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}
      >
        {icon}
      </div>
      <p className="mb-2 text-sm font-semibold tracking-tight" style={{ color: 'var(--c-heading)' }}>
        {title}
      </p>
      <p className="mb-5 text-sm max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--c-text-2)' }}>
        {description}
      </p>
      {action}
    </div>
  )
}
