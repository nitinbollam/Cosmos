'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Sidebar } from '@src/components/layout/sidebar'

function titleFromPath(path: string) {
  if (path === '/' || path === '') return 'Overview'
  const seg = path.split('/').filter(Boolean)[0] ?? ''
  if (!seg) return 'Cosmos'
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ')
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname() ?? '/'

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--c-bg)' }}>
      <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="h-[72px] shrink-0 flex items-center justify-between px-7"
          style={{ borderBottom: '1px solid var(--c-border)' }}
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: 'rgba(241,245,249,0.45)' }}>
              Cosmos Admin
            </p>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--c-on-dark)' }}>
              {titleFromPath(pathname)}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/notifications"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(241,245,249,0.8)' }}
              title="Alerts"
              aria-label="Notifications"
            >
              ···
            </Link>
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center text-xs font-bold"
              style={{ background: 'var(--c-accent)', color: '#fff' }}
            >
              A
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
