import Image from '@/components/cosmos-img'
import { Link } from 'react-router-dom'
import { useLocation } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  SIDEBAR_NAV,
  isNavActive,
  sectionHasActive,
  type SidebarNavEntry,
  type SidebarNavSection,
} from '@/components/layout/sidebar-nav.config'

export { SIDEBAR_NAV }

function NavLink({
  href,
  label,
  collapsed,
  indent,
}: {
  href: string
  label: string
  collapsed: boolean
  indent?: boolean
}) {
  const pathname = useLocation().pathname ?? '/admin'
  const active = isNavActive(pathname, href)

  if (collapsed) {
    return (
      <Link
        to={href}
        title={label}
        className={`cosmos-nav-link ${active ? 'cosmos-nav-link--active' : ''}`}
        style={{ justifyContent: 'center', paddingLeft: 8, paddingRight: 8 }}
      >
        <span className="cosmos-nav-short">{label.slice(0, 2).toUpperCase()}</span>
      </Link>
    )
  }

  return (
    <Link
      to={href}
      title={label}
      className={`cosmos-nav-link ${active ? 'cosmos-nav-link--active' : ''}`}
      style={indent ? { paddingLeft: 28 } : undefined}
    >
      {!indent ? <span className="cosmos-nav-short">{label.slice(0, 2).toUpperCase()}</span> : null}
      <span className="truncate">{label}</span>
    </Link>
  )
}

function NavSectionBlock({
  section,
  collapsed,
  open,
  onToggle,
}: {
  section: SidebarNavSection
  collapsed: boolean
  open: boolean
  onToggle: () => void
}) {
  const pathname = useLocation().pathname ?? '/admin'
  const active = sectionHasActive(pathname, section)

  if (collapsed) {
    const first = section.items[0]
    if (!first) return null
    return <NavLink href={first.href} label={section.label} collapsed />
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm rounded-xl transition-colors text-left"
        style={{
          background: active && !open ? 'var(--c-nav-icon-bg)' : 'transparent',
          color: active ? 'var(--c-on-dark)' : 'var(--c-nav-fg)',
          fontWeight: 600,
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <span className="truncate">{section.label}</span>
        <span className="text-xs opacity-60 shrink-0">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="mt-0.5 mb-2 space-y-0.5">
          {section.items.map((item) => (
            <NavLink key={item.href + item.label} href={item.href} label={item.label} collapsed={false} indent />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const pathname = useLocation().pathname ?? '/admin'
  const asideClass = collapsed
    ? 'w-[76px] shrink-0 flex flex-col cosmos-sidebar'
    : 'w-[280px] shrink-0 flex flex-col cosmos-sidebar'

  const defaultOpen = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of SIDEBAR_NAV) {
      if (entry.type === 'section' && sectionHasActive(pathname, entry)) ids.add(entry.id)
    }
    if (ids.size === 0) ids.add('product')
    return ids
  }, [pathname])

  const [openSections, setOpenSections] = useState<Set<string>>(defaultOpen)

  useEffect(() => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      for (const entry of SIDEBAR_NAV) {
        if (entry.type === 'section' && sectionHasActive(pathname, entry)) next.add(entry.id)
      }
      return next
    })
  }, [pathname])

  return (
    <aside className={asideClass}>
      <div className="h-[72px] flex items-center gap-2 px-3 shrink-0">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          className="btn-ghost shrink-0 !p-2 !text-xs !min-w-0"
        >
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
      <nav className="flex-1 py-2 px-2 overflow-y-auto sidebar-scroll">
        {SIDEBAR_NAV.map((entry: SidebarNavEntry) => {
          if (entry.type === 'link') {
            return <NavLink key={entry.href} href={entry.href} label={entry.label} collapsed={collapsed} />
          }
          return (
            <NavSectionBlock
              key={entry.id}
              section={entry}
              collapsed={collapsed}
              open={openSections.has(entry.id)}
              onToggle={() =>
                setOpenSections((prev) => {
                  const next = new Set(prev)
                  if (next.has(entry.id)) next.delete(entry.id)
                  else next.add(entry.id)
                  return next
                })
              }
            />
          )
        })}
      </nav>
    </aside>
  )
}
