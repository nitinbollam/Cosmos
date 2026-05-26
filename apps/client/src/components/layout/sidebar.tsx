import Image from '@/components/cosmos-img'
import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'

export const SIDEBAR_NAV: { href: string; label: string; short: string }[] = [
  { href: '/admin', label: 'Dashboard', short: 'Db' },
  { href: '/admin/inventory', label: 'Inventory', short: 'In' },
  { href: '/admin/orders', label: 'Orders', short: 'Or' },
  { href: '/admin/warehouse', label: 'Warehouse', short: 'Wh' },
  { href: '/admin/purchasing', label: 'Purchasing', short: 'Po' },
  { href: '/admin/compliance', label: 'Compliance', short: 'Co' },
  { href: '/admin/crm', label: 'CRM', short: 'Cr' },
  { href: '/admin/dispatch', label: 'Dispatch', short: 'Di' },
  { href: '/admin/finance', label: 'Finance', short: 'Fi' },
  { href: '/admin/settings', label: 'Settings', short: 'St' },
]

export function Sidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const pathname = useLocation().pathname ?? '/admin'
  const asideClass = collapsed ? 'w-[76px] shrink-0 flex flex-col cosmos-sidebar' : 'w-[228px] shrink-0 flex flex-col cosmos-sidebar'

  return (
    <aside className={asideClass}>
      <div className="h-[72px] flex items-center gap-2 px-3">
        <button type="button" aria-expanded={!collapsed} onClick={onToggleCollapsed} className="btn-ghost shrink-0 !p-2 !text-xs !min-w-0">
          {collapsed ? '»' : '«'}
        </button>
        {!collapsed ? (
          <Link to="/admin" className="flex items-center min-w-0 py-1">
            <Image
              src="/cosmos-logo.png"
              alt="Cosmos"
              width={140}
              height={36}
              className="h-8 w-auto max-w-[120px] object-contain"
              priority
            />
          </Link>
        ) : (
          <Link to="/admin" className="flex-1 flex justify-center py-1" title="Cosmos">
            <span className="cosmos-nav-short">C</span>
          </Link>
        )}
      </div>
      <nav className="flex-1 py-2 px-2 overflow-y-auto">
        {SIDEBAR_NAV.map((item) => {
          const active =
            item.href === '/admin'
              ? pathname === '/admin' || pathname === '/admin/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              to={item.href}
              title={item.label}
              className={`cosmos-nav-link ${active ? 'cosmos-nav-link--active' : ''}`}
            >
              <span className="cosmos-nav-short">{item.short}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
