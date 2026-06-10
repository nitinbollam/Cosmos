import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { CosmosLogo } from '@/components/cosmos-logo'
import { api, formatApiReachabilityError } from '@/lib/api-admin'
import { axiosErr } from '@/lib/axios-error'
import { emitStorefrontAuthChanged } from '@/lib/auth-events'

export default function LoginPage() {
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
      emitStorefrontAuthChanged()
      const next = new URLSearchParams(window.location.search).get('next')
      navigate(next?.startsWith('/') ? next : '/admin')
    } catch (e) {
      setErr(formatApiReachabilityError(e) || axiosErr(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--c-bg)' }}>
      <AuthThemeToolbar />
      <form onSubmit={submit} className="bento-cell bento-tone-white w-full max-w-sm space-y-4">
        <div className="flex justify-center pb-2">
          <CosmosLogo size="lg" />
        </div>
        <div>
          <p className="bento-kpi-label">Admin</p>
          <h1 className="bento-hero-title mt-2" style={{ fontSize: '1.5rem' }}>
            Sign in
          </h1>
          <p className="bento-section-sub">Access your distribution command center</p>
        </div>
        <input className="cosmos-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="cosmos-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="text-sm font-medium" style={{ color: 'var(--c-danger)' }}>{err}</p>}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Continue'}
        </button>
        <p className="text-center">
          <a href="/forgot-password" className="text-sm" style={{ color: 'var(--c-accent)' }}>
            Forgot password?
          </a>
        </p>
      </form>
    </div>
  )
}
