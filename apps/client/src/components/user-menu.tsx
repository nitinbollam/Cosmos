import { useCallback, useEffect, useRef, useState } from 'react'
import { jwtEmail } from '@/lib/jwt'
import { signOut } from '@/lib/auth-session'
import { STOREFRONT_AUTH_EVENT } from '@/lib/auth-events'
import { ThemeSwitcher } from '@/components/theme-switcher'

type UserMenuProps = {
  afterLogout?: string
  showTheme?: boolean
}

function initialsFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
  return local.slice(0, 2).toUpperCase()
}

export function UserMenu({ afterLogout = '/', showTheme = true }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('cosmos.accessToken') : null
    setEmail(jwtEmail(token))
  }, [])

  useEffect(() => {
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cosmos.accessToken' || e.key === null) refresh()
    }
    const onAuth = () => refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(STOREFRONT_AUTH_EVENT, onAuth)
    }
  }, [refresh])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const token = typeof window !== 'undefined' ? window.localStorage.getItem('cosmos.accessToken') : null
  if (!token) return null

  const label = email ?? 'Account'
  const initials = email ? initialsFromEmail(email) : 'AC'

  return (
    <div className="cosmos-user-menu" ref={rootRef}>
      <button
        type="button"
        className="cosmos-icon-btn cosmos-avatar-btn"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {initials}
      </button>
      {open ? (
        <div className="cosmos-user-menu-dropdown">
          <p className="cosmos-user-menu-email">{label}</p>
          {showTheme ? (
            <div className="cosmos-user-menu-section">
              <p className="cosmos-user-menu-label">Theme</p>
              <ThemeSwitcher compact />
            </div>
          ) : null}
          <button
            type="button"
            className="cosmos-user-menu-signout"
            onClick={() => void signOut({ redirectTo: afterLogout })}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}
