import { Link, Outlet } from 'react-router-dom'
import { RequireOpsAccess } from '@/components/auth/require-super-admin'
import { PlerosLogo } from '@/components/pleros-logo'

/** Pleros internal ops — no ERP sidebar or tenant backoffice chrome. */
export function OpsLayout() {
  return (
    <RequireOpsAccess>
      <div className="min-h-screen" style={{ background: 'var(--c-bg)', color: 'var(--c-text)' }}>
        <header
          className="border-b px-4 py-3 flex items-center justify-between gap-4"
          style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface)' }}
        >
          <div className="flex items-center gap-3">
            <PlerosLogo className="h-7 w-auto" />
            <div>
              <p className="text-xs uppercase tracking-wider text-pleros-text-3">Pleros internal</p>
              <p className="text-sm font-medium text-pleros-white">Marketplace ops</p>
            </div>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link to="/ops/marketplace" className="text-pleros-accent hover:underline">
              Console
            </Link>
            <Link to="/admin" className="text-pleros-text-3 hover:text-pleros-white">
              ERP (tenant)
            </Link>
          </nav>
        </header>
        <main className="max-w-6xl mx-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </RequireOpsAccess>
  )
}
