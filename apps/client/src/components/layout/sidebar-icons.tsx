import type { ReactNode } from 'react'

type SidebarIconName =
  | 'dashboard'
  | 'inventory'
  | 'orders'
  | 'fulfillment'
  | 'warehouse'
  | 'purchasing'
  | 'compliance'
  | 'crm'
  | 'dispatch'
  | 'finance'
  | 'celestial'
  | 'settings'

export function SidebarIcon({ name }: { name: SidebarIconName }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="cosmos-nav-icon">
      {icons[name]}
    </svg>
  )
}

export type { SidebarIconName }

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const icons: Record<SidebarIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" {...stroke} />
      <rect x="14" y="3" width="7" height="7" rx="1.5" {...stroke} />
      <rect x="3" y="14" width="7" height="7" rx="1.5" {...stroke} />
      <rect x="14" y="14" width="7" height="7" rx="1.5" {...stroke} />
    </>
  ),
  inventory: (
    <>
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" {...stroke} />
      <path d="M12 12v9M4 7.5 12 12l8-4.5" {...stroke} />
    </>
  ),
  orders: (
    <>
      <path d="M7 4h10l2 4v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8l2-4Z" {...stroke} />
      <path d="M7 8h10M9 12h6M9 16h4" {...stroke} />
    </>
  ),
  fulfillment: (
    <>
      <path d="M3 7h11v10H3V7Z" {...stroke} />
      <path d="M14 10h4l3 3v4h-7v-7Z" {...stroke} />
      <circle cx="7" cy="18" r="2" {...stroke} />
      <circle cx="18" cy="18" r="2" {...stroke} />
    </>
  ),
  warehouse: (
    <>
      <path d="M3 10 12 4l9 6" {...stroke} />
      <path d="M5 10v9h14v-9" {...stroke} />
      <path d="M10 19v-5h4v5" {...stroke} />
    </>
  ),
  purchasing: (
    <>
      <path d="M6 6h15l-1.5 9H7.5L6 6Z" {...stroke} />
      <path d="M6 6 5 3H3" {...stroke} />
      <circle cx="9" cy="19" r="1.5" {...stroke} />
      <circle cx="18" cy="19" r="1.5" {...stroke} />
    </>
  ),
  compliance: (
    <>
      <path d="M12 3 4 6v6c0 4.5 3.4 7.4 8 9 4.6-1.6 8-4.5 8-9V6l-8-3Z" {...stroke} />
      <path d="m9 12 2 2 4-4" {...stroke} />
    </>
  ),
  crm: (
    <>
      <circle cx="9" cy="8" r="3" {...stroke} />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" {...stroke} />
      <path d="M17 11h4M19 9v4" {...stroke} />
    </>
  ),
  dispatch: (
    <>
      <path d="M4 6h16v12H4V6Z" {...stroke} />
      <path d="M8 10h8M8 14h5" {...stroke} />
      <circle cx="18" cy="18" r="3" {...stroke} />
      <path d="M18 15v-2" {...stroke} />
    </>
  ),
  finance: (
    <>
      <path d="M4 19V5" {...stroke} />
      <path d="M4 19h16" {...stroke} />
      <path d="M8 15l3-4 3 2 4-6" {...stroke} />
    </>
  ),
  celestial: (
    <>
      <path d="M12 3 13.5 8.5 19 10l-5.5 1.5L12 17l-1.5-5.5 7-1.5-5.5-1.5L12 3Z" {...stroke} />
      <path d="M5 5l.9 2.1L8 8l-2.1.9L5 11l-.9-2.1L2 8l2.1-.9L5 5Z" {...stroke} />
      <path d="M18 16l.7 1.6 1.7.7-1.7.7-.7 1.6-.7-1.6-1.7-.7 1.7-.7.7-1.6Z" {...stroke} />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" {...stroke} />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"
        {...stroke}
      />
    </>
  ),
}
