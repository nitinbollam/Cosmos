import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { PlerosLogo } from '@/components/pleros-logo'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr, isEmailVerificationRequired } from '@/lib/axios-error'
import { emitStorefrontAuthChanged } from '@/lib/auth-events'
import { setB2bSession } from '@/lib/session'

type LoginRes = { accessToken: string; refreshToken: string }

type AuthMe = {
  tenantId: string
  customerId: string | null
  customerName: string | null
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [resendSent, setResendSent] = useState(false)
  const [resendBusy, setResendBusy] = useState(false)
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setNeedsVerification(false)
    setResendSent(false)
    setDevVerifyUrl(null)
    setLoading(true)
    try {
      const r = await api.post<LoginRes>('/auth/login', { email, password })
      window.localStorage.setItem('pleros.accessToken', r.accessToken)
      window.localStorage.setItem('pleros.refreshToken', r.refreshToken)

      const me = await api.get<AuthMe>('/auth/me')
      if (!me.customerId) {
        setErr(
          'No CRM customer record matches your email. Ask your tenant admin to create a customer with this address.',
        )
        window.localStorage.removeItem('pleros.accessToken')
        window.localStorage.removeItem('pleros.refreshToken')
        return
      }

      setB2bSession(me.tenantId, me.customerId)
      emitStorefrontAuthChanged()
      window.location.href = '/catalog'
    } catch (e: unknown) {
      if (isEmailVerificationRequired(e)) {
        setNeedsVerification(true)
        setErr('Please verify your email before signing in.')
      } else {
        setErr(axiosErr(e))
      }
    } finally {
      setLoading(false)
    }
  }

  async function resendVerification() {
    setResendBusy(true)
    setErr(null)
    setDevVerifyUrl(null)
    try {
      const res = await api.post<{ ok?: boolean; verifyUrl?: string }>('/auth/resend-verification', {
        email: email.trim(),
      })
      setResendSent(true)
      if (res.verifyUrl) setDevVerifyUrl(res.verifyUrl)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setResendBusy(false)
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
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, color: 'var(--c-heading)', margin: '16px 0 0' }}>
            Welcome back
          </h1>
          <p style={{ color: 'var(--c-text-2)', fontSize: 14, marginTop: 8 }}>B2B buyer portal</p>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="pleros-input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="Email" />
          <input
            className="pleros-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            placeholder="Password"
          />
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        {err ? <p style={{ marginTop: 16, color: 'var(--c-danger)', fontSize: 14 }}>{err}</p> : null}
        {needsVerification ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              background: 'var(--c-surface-2)',
              border: '1px solid var(--c-border)',
            }}
          >
            <p style={{ color: 'var(--c-text-2)', fontSize: 14, marginBottom: 12 }}>
              Check your inbox for the verification link, or request a new one.
            </p>
            <Link
              to={`/verify-email${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}
              style={{ color: 'var(--c-accent)', fontSize: 13, display: 'block', marginBottom: 12 }}
            >
              Open verification page →
            </Link>
            <button
              type="button"
              className="btn-ghost"
              style={{ width: '100%' }}
              disabled={resendBusy || !email.trim()}
              onClick={() => void resendVerification()}
            >
              {resendBusy ? 'Sending…' : 'Resend verification email'}
            </button>
            {resendSent ? (
              <p style={{ marginTop: 10, color: 'var(--c-text-3)', fontSize: 13, textAlign: 'center' }}>
                {devVerifyUrl
                  ? 'No email provider configured — use the link below.'
                  : 'If an unverified account exists for that address, a new link was sent.'}
              </p>
            ) : null}
            {devVerifyUrl ? (
              <div style={{ marginTop: 12 }}>
                <a href={devVerifyUrl} style={{ color: 'var(--c-accent)', fontSize: 12, wordBreak: 'break-all' }}>
                  {devVerifyUrl}
                </a>
                <div style={{ marginTop: 10 }}>
                  <Link
                    to={devVerifyUrl.replace(/^https?:\/\/[^/]+/, '')}
                    className="btn-primary"
                    style={{ display: 'inline-block', width: '100%', textAlign: 'center' }}
                  >
                    Verify email now
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <p style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/forgot-password" style={{ color: 'var(--c-accent)', fontSize: 13 }}>
            Forgot password?
          </Link>
        </p>
        <p style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/" style={{ color: 'var(--c-accent)', fontSize: 13 }}>
            ← Home
          </Link>
        </p>
      </div>
    </main>
  )
}
