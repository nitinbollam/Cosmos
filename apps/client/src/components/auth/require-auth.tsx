import { useSessionGate } from './use-session-gate'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const ready = useSessionGate({ surface: 'admin', loginPath: '/admin/login', staffOnly: true })

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-pleros-text-3 text-sm">
        Checking session…
      </div>
    )
  }

  return <>{children}</>
}
