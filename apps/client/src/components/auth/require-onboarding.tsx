import { useQuery } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from '@/lib/api-admin'

type TenantMe = {
  onboardingPhase: string
}

export function RequireOnboardingComplete({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const tenantQ = useQuery<TenantMe>({
    queryKey: ['tenant-me', 'onboarding-gate'],
    queryFn: () => api.get('/tenants/me'),
    staleTime: 30_000,
  })

  if (tenantQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-pleros-text-3 text-sm">
        Loading workspace…
      </div>
    )
  }

  if (tenantQ.data?.onboardingPhase !== 'READY' && pathname !== '/admin/onboarding') {
    return <Navigate to="/admin/onboarding" replace />
  }

  return <>{children}</>
}
