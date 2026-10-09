import { useSessionGate } from './use-session-gate'

/** B2B marketplace browse requires a signed-in tenant staff session (not portal-only). */
export function RequireMarketplaceShop({ children }: { children: React.ReactNode }) {
  const ready = useSessionGate({ surface: 'shop', loginPath: '/login' })

  if (!ready) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-pleros-text-3 text-sm">
        Checking session…
      </div>
    )
  }

  return <>{children}</>
}
