import { useQuery } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from '@/lib/api-admin'
import { RequireAuth } from '@/components/auth/require-auth'

export function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const meQ = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get<{ role?: string }>('/auth/me'),
  })

  if (meQ.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-pleros-text-3 text-sm">
        Verifying access…
      </div>
    )
  }

  if (meQ.data?.role !== 'SUPER_ADMIN') {
    return <Navigate to="/admin" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}

export function RequireOpsAccess({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RequireSuperAdmin>{children}</RequireSuperAdmin>
    </RequireAuth>
  )
}
