import { Outlet, useLocation } from 'react-router-dom'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { RequireAuth } from '@/components/auth/require-auth'
import { RequireOnboardingComplete } from '@/components/auth/require-onboarding'

function isAdminLoginPath(pathname: string): boolean {
  return pathname === '/admin/login' || pathname.startsWith('/admin/login/')
}

function isOnboardingPath(pathname: string): boolean {
  return pathname === '/admin/onboarding' || pathname.startsWith('/admin/onboarding/')
}

export function AdminLayout() {
  const { pathname } = useLocation()

  if (isAdminLoginPath(pathname)) {
    return <Outlet />
  }

  if (isOnboardingPath(pathname)) {
    return (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    )
  }

  return (
    <RequireAuth>
      <RequireOnboardingComplete>
        <DashboardShell>
          <Outlet />
        </DashboardShell>
      </RequireOnboardingComplete>
    </RequireAuth>
  )
}
