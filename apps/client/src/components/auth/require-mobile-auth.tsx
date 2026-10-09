import { useSessionGate } from './use-session-gate'

export function RequireMobileAuth({ children }: { children: React.ReactNode }) {
  const ready = useSessionGate({ surface: 'mobile', loginPath: '/m/login', staffOnly: true })

  if (!ready) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-pleros-text-3 text-sm">
        Checking session…
      </div>
    )
  }

  return <>{children}</>
}
