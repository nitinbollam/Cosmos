import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { useState } from 'react'
import { Sidebar } from '@/components/layout/sidebar'

function titleFromPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  const seg = parts[0] === 'admin' ? (parts[1] ?? '') : (parts[0] ?? '')
  if (!seg || seg === 'admin') return 'Overview'
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ')
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = useLocation().pathname ?? '/'

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--c-bg)' }}>
      <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="cosmos-admin-header">
          <div>
            <p className="cosmos-admin-header-label">Cosmos Admin</p>
            <h1 className="cosmos-admin-header-title">{titleFromPath(pathname)}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/admin/notifications" className="cosmos-icon-btn" title="Alerts" aria-label="Notifications">
              ···
            </Link>
            <div className="cosmos-icon-btn text-xs">A</div>
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
