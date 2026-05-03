'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Sidebar } from '@src/components/layout/sidebar'

function titleFromPath(path: string) {
  if (path === '/' || path === '') return 'Dashboard'
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
          className="h-14 shrink-0 flex items-center justify-between px-6 border-b"
          style={{
            borderColor: 'var(--c-border)',
            background: 'var(--c-surface)',
            paddingLeft: 24,
            paddingRight: 24,
          }}
        >
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: 'var(--c-white)' }}>
            {titleFromPath(pathname)}
          </h1>
          <div className="flex items-center gap-4">
            <Link
              href="/notifications"
              className="text-xl leading-none opacity-90 hover:opacity-100"
              title="Alerts"
              aria-label="Notifications"
            >
              🔔
            </Link>
            <div
              className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: 'var(--c-primary-dim)', color: 'var(--c-primary)', fontFamily: 'var(--font-body)' }}
            >
              A
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto" style={{ background: 'var(--c-bg)', padding: 0 }}>
          {children}
        </main>
      </div>
    </div>
  )
}
