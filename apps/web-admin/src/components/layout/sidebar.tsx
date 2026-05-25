'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const SIDEBAR_NAV: { href: string; label: string; short: string }[] = [
  { href: '/', label: 'Dashboard', short: 'Db' },
  { href: '/inventory', label: 'Inventory', short: 'In' },
  { href: '/orders', label: 'Orders', short: 'Or' },
  { href: '/warehouse', label: 'Warehouse', short: 'Wh' },
  { href: '/purchasing', label: 'Purchasing', short: 'Po' },
  { href: '/compliance', label: 'Compliance', short: 'Co' },
  { href: '/crm', label: 'CRM', short: 'Cr' },
  { href: '/dispatch', label: 'Dispatch', short: 'Di' },
  { href: '/finance', label: 'Finance', short: 'Fi' },
  { href: '/settings', label: 'Settings', short: 'St' },
]

export function Sidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const pathname = usePathname() ?? '/'
  const asideClass = collapsed ? 'w-[76px] shrink-0 flex flex-col' : 'w-[228px] shrink-0 flex flex-col'

  return (
    <aside className={asideClass} style={{ background: 'var(--c-bg-elevated)', borderRight: '1px solid var(--c-border)' }}>
      <div className="h-[72px] flex items-center gap-2 px-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          className="btn-ghost shrink-0 !p-2 !text-xs !min-w-0"
        >
          {collapsed ? '»' : '«'}
        </button>
        {!collapsed ? (
          <Link href="/" className="flex items-center min-w-0 py-1">
            <Image
              src="/cosmos-logo.png"
              alt="Cosmos"
              width={140}
              height={36}
              className="h-8 w-auto max-w-[120px] object-contain brightness-0 invert opacity-90"
              priority
            />
          </Link>
        ) : (
          <Link href="/" className="flex-1 flex justify-center py-1" title="Cosmos">
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold"
              style={{ background: 'var(--c-accent-soft)', color: 'var(--c-accent)' }}
            >
              C
            </span>
          </Link>
        )}
      </div>
      <nav className="flex-1 py-2 px-2 overflow-y-auto">
        {SIDEBAR_NAV.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/' || pathname === ''
              : pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className="flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl mb-1 transition-colors"
              style={{
                background: active ? '#ffffff' : 'transparent',
                color: active ? 'var(--c-heading)' : 'rgba(241,245,249,0.72)',
                fontWeight: active ? 600 : 500,
                boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
                style={{
                  background: active ? 'var(--c-accent-soft)' : 'rgba(255,255,255,0.06)',
                  color: active ? 'var(--c-accent)' : 'rgba(241,245,249,0.55)',
                }}
              >
                {item.short}
              </span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
