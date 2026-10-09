import { useQuery } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from '@/lib/api-admin'

type AuthMe = {
  onboardingPhase?: string
}

export function RequireOnboardingComplete({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  const meQ = useQuery<AuthMe>({
    queryKey: ['auth-me', 'onboarding-gate'],
    queryFn: () => api.get('/auth/me'),
    staleTime: 30_000,
  })

  if (meQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-pleros-text-3 text-sm">
        Loading workspace…
      </div>
    )
  }

  if (meQ.data?.onboardingPhase !== 'READY' && pathname !== '/admin/onboarding') {
    return <Navigate to="/admin/onboarding" replace />
  }

  return <>{children}</>
}
