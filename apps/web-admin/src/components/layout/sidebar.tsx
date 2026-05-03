'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Cosmos admin primary nav — matches FRONTEND COMPLETION PROMPT table. */
export const SIDEBAR_NAV: { href: string; label: string; icon: string }[] = [
  { href: '/', label: 'Dashboard', icon: '🏠' },
  { href: '/inventory', label: 'Inventory', icon: '📦' },
  { href: '/orders', label: 'Orders', icon: '🛒' },
  { href: '/warehouse', label: 'Warehouse', icon: '🏭' },
  { href: '/purchasing', label: 'Purchasing', icon: '🚚' },
  { href: '/compliance', label: 'Compliance', icon: '✅' },
  { href: '/crm', label: 'CRM', icon: '👥' },
  { href: '/dispatch', label: 'Dispatch', icon: '🚗' },
  { href: '/finance', label: 'Finance', icon: '💰' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
]

export function Sidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const pathname = usePathname() ?? '/'
  const rail = collapsed ? 'w-16' : 'w-60' // 64px / 240px

  return (
    <aside
      className={`${rail} shrink-0 border-r flex flex-col transition-all duration-200`}
      style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface)' }}
    >
      <div
        className="h-14 flex items-center gap-2 px-2 border-b"
        style={{ borderColor: 'var(--c-border)' }}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          className="btn-ghost shrink-0 !p-2 !text-sm"
        >
          {collapsed ? '»' : '«'}
        </button>
        {!collapsed ? (
          <Link href="/" className="flex items-center min-w-0 py-1">
            <Image
              src="/cosmos-logo.png"
              alt="Cosmos"
              width={160}
              height={40}
              className="h-10 w-auto max-w-[140px] object-contain"
              style={{ maxHeight: 40 }}
              priority
            />
          </Link>
        ) : (
          <Link href="/" className="flex-1 flex justify-center py-1" title="Cosmos">
            <Image src="/cosmos-logo.png" alt="" width={40} height={40} className="h-10 w-10 object-contain" />
          </Link>
        )}
      </div>
      <nav className="flex-1 py-2 overflow-y-auto">
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
              className="flex items-center gap-3 px-2 py-2.5 text-sm mx-1 rounded-lg"
              style={{
                borderLeft: active ? '3px solid var(--c-primary)' : '3px solid transparent',
                background: active ? 'var(--c-primary-dim)' : 'transparent',
                color: active ? 'var(--c-white)' : 'var(--c-text)',
                fontFamily: 'var(--font-body)',
              }}
            >
              <span className="text-base w-7 text-center shrink-0">{item.icon}</span>
              {!collapsed && <span className="font-semibold truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
