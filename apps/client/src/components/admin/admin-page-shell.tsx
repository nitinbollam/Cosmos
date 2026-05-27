export function AdminPageShell({
  title,
  section,
  description,
  actions,
  children,
}: {
  title: string
  section?: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {section ? (
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--c-text-3)' }}>
              {section}
            </p>
          ) : null}
          <h1 className="text-2xl font-bold" style={{ color: 'var(--c-on-dark)', fontFamily: 'var(--font-display)' }}>
            {title}
          </h1>
          {description ? <p className="text-sm mt-1" style={{ color: 'var(--c-text-2)' }}>{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}
