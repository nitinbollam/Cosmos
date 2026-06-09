import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { api, formatApiReachabilityError } from '@/lib/api-mobile'
import { axiosErr } from '@/lib/axios-error'
import { parseJwtPayload } from '@/lib/jwt'

function defaultMobileHome(role: string | undefined): string {
  if (role === 'DRIVER') return '/m/delivery'
  if (role === 'WAREHOUSE_STAFF') return '/m/warehouse'
  return '/m/sales'
}

export default function MobileLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      const r = await api.post<{ accessToken: string; refreshToken: string }>('/auth/login', { email, password })
      window.localStorage.setItem('cosmos.accessToken', r.accessToken)
      window.localStorage.setItem('cosmos.refreshToken', r.refreshToken)
      const next = new URLSearchParams(window.location.search).get('next')
      if (next?.startsWith('/m/')) {
        navigate(next)
        return
      }
      const payload = parseJwtPayload(r.accessToken)
      const role = typeof payload?.role === 'string' ? payload.role : undefined
      navigate(defaultMobileHome(role))
    } catch (e) {
      setErr(formatApiReachabilityError(e) || axiosErr(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cosmos-mobile" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AuthThemeToolbar />
      <header className="cosmos-mobile-header">
        <Link to="/" className="cosmos-shop-link" style={{ fontSize: 13 }}>
          ← Hub
        </Link>
        <span style={{ fontWeight: 700, flex: 1, fontFamily: 'var(--font-display)' }}>Cosmos Mobile</span>
      </header>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <form onSubmit={submit} className="cosmos-mobile-card w-full max-w-sm space-y-4">
          <div>
            <h1 style={{ fontFamily: 'var(--font-syne)', fontSize: '1.25rem', margin: 0 }}>Sign in</h1>
            <p style={{ marginTop: 8, fontSize: 13, opacity: 0.7 }}>Warehouse, delivery, and field sales</p>
          </div>
          <input className="cosmos-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="cosmos-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err ? <p style={{ color: 'var(--c-danger)', fontSize: 13 }}>{err}</p> : null}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Continue'}
          </button>
          <p style={{ fontSize: 12, opacity: 0.65, textAlign: 'center' }}>
            Admin users?{' '}
            <Link to="/admin/login" style={{ color: 'var(--c-accent)' }}>
              Cosmos Admin login
            </Link>
          </p>
        </form>
      </main>
    </div>
  )
}
