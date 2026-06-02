import { Outlet, useLocation } from 'react-router-dom'
import { DashboardShell } from '@/components/layout/dashboard-shell'
import { RequireAuth } from '@/components/auth/require-auth'

function isAdminLoginPath(pathname: string): boolean {
  return pathname === '/admin/login' || pathname.startsWith('/admin/login/')
}

export function AdminLayout() {
  const { pathname } = useLocation()

  if (isAdminLoginPath(pathname)) {
    return <Outlet />
  }

  return (
    <RequireAuth>
      <DashboardShell>
        <Outlet />
      </DashboardShell>
    </RequireAuth>
  )
}
