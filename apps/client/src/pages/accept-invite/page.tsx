import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { PlerosLogo } from '@/components/pleros-logo'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { emitStorefrontAuthChanged } from '@/lib/auth-events'
import { setB2bSession } from '@/lib/session'

type AcceptRes = { accessToken: string; refreshToken: string; role: string }

type AuthMe = { tenantId: string; customerId: string | null }

export default function AcceptInvitePage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (password !== confirm) {
      setErr('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const r = await api.post<AcceptRes>('/auth/accept-invite', { token, firstName, lastName, password })
      window.localStorage.setItem('pleros.accessToken', r.accessToken)
      window.localStorage.setItem('pleros.refreshToken', r.refreshToken)
      emitStorefrontAuthChanged()
      // Users whose email matches a CRM customer land in the buyer portal; staff go to admin.
      const me = await api.get<AuthMe>('/auth/me')
      if (me.customerId) {
        setB2bSession(me.tenantId, me.customerId)
        window.location.href = '/catalog'
      } else {
        window.location.href = '/admin'
      }
    } catch (e: unknown) {
      setErr(axiosErr(e))
      setLoading(false)
    }
  }

  return (
    <main className="pleros-auth-page">
      <AuthThemeToolbar />
      <div className="pleros-card pleros-auth-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', justifyContent: 'center' }}>
            <PlerosLogo size="lg" />
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, color: 'var(--c-heading)', margin: '16px 0 0' }}>
            Join your team
          </h1>
          <p style={{ color: 'var(--c-text-2)', fontSize: 14, marginTop: 8 }}>
            Finish setting up your Pleros account
          </p>
        </div>
        {!token ? (
          <p style={{ color: 'var(--c-danger)', fontSize: 14, textAlign: 'center' }}>
            This invite link is missing its token. Ask your admin to send a new invite.
          </p>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <input
                className="pleros-input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                placeholder="First name"
              />
              <input
                className="pleros-input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                placeholder="Last name"
              />
            </div>
            <input
              className="pleros-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={10}
              placeholder="Password (10+ chars, letter + number)"
            />
            <input
              className="pleros-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              type="password"
              required
              minLength={10}
              placeholder="Confirm password"
            />
            <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}
        {err ? <p style={{ marginTop: 16, color: 'var(--c-danger)', fontSize: 14 }}>{err}</p> : null}
        <p style={{ marginTop: 20, textAlign: 'center' }}>
          <Link to="/" style={{ color: 'var(--c-accent)', fontSize: 13 }}>
            ← Home
          </Link>
        </p>
      </div>
    </main>
  )
}
