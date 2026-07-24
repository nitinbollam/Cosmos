import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { PlerosLogo } from '@/components/pleros-logo'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [done, setDone] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendEmail, setResendEmail] = useState('')
  const [resendSent, setResendSent] = useState(false)
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null)

  useEffect(() => {
    if (token && !done && !loading) void verify()
    const prefill = params.get('email')
    if (prefill) setResendEmail(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when token is present
  }, [token])

  async function verify() {
    if (!token) return
    setLoading(true)
    setErr(null)
    try {
      await api.post('/auth/verify-email', { token })
      setDone(true)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setLoading(false)
    }
  }

  async function resend(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    setDevVerifyUrl(null)
    try {
      const res = await api.post<{ ok?: boolean; verifyUrl?: string }>('/auth/resend-verification', {
        email: resendEmail.trim(),
      })
      setResendSent(true)
      if (res.verifyUrl) setDevVerifyUrl(res.verifyUrl)
    } catch (ex: unknown) {
      setErr(axiosErr(ex))
    } finally {
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
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 24,
              color: 'var(--c-heading)',
              margin: '16px 0 0',
            }}
          >
            Verify your email
          </h1>
        </div>

        {done ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--c-text-2)', fontSize: 14 }}>Your email is verified. You can sign in now.</p>
            <Link to="/admin/login" className="btn-primary" style={{ display: 'inline-block', marginTop: 16 }}>
              Sign in
            </Link>
          </div>
        ) : token ? (
          <div style={{ textAlign: 'center' }}>
            <button type="button" className="btn-primary" disabled={loading} onClick={() => void verify()}>
              {loading ? 'Verifying…' : 'Confirm email'}
            </button>
          </div>
        ) : (
          <p style={{ color: 'var(--c-text-2)', fontSize: 14, textAlign: 'center' }}>
            Open the link from your verification email, or request a new one below.
          </p>
        )}

        {err ? <p style={{ marginTop: 16, color: 'var(--c-danger)', fontSize: 14 }}>{err}</p> : null}

        {!done ? (
          <form onSubmit={resend} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="pleros-input"
              type="email"
              placeholder="Your email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              required
            />
            <button type="submit" className="btn-ghost" disabled={loading || !resendEmail.trim()}>
              {loading ? 'Sending…' : 'Resend verification email'}
            </button>
            {resendSent ? (
              <p style={{ color: 'var(--c-text-3)', fontSize: 13, textAlign: 'center' }}>
                {devVerifyUrl
                  ? 'Email provider not configured — use the verification link below to continue.'
                  : 'If an unverified account exists for that address, a new link was sent.'}
              </p>
            ) : null}
            {devVerifyUrl ? (
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--c-surface-2)',
                  border: '1px solid var(--c-border)',
                }}
              >
                <p style={{ color: 'var(--c-text-3)', fontSize: 12, marginBottom: 8 }}>Verification link</p>
                <a href={devVerifyUrl} style={{ color: 'var(--c-accent)', fontSize: 13, wordBreak: 'break-all' }}>
                  {devVerifyUrl}
                </a>
                <div style={{ marginTop: 12 }}>
                  <Link
                    to={devVerifyUrl.replace(/^https?:\/\/[^/]+/, '')}
                    className="btn-primary"
                    style={{ display: 'inline-block' }}
                  >
                    Verify email now
                  </Link>
                </div>
              </div>
            ) : null}
          </form>
        ) : null}

        <p style={{ marginTop: 20, textAlign: 'center' }}>
          <Link to="/" style={{ color: 'var(--c-accent)', fontSize: 13 }}>
            ← Home
          </Link>
        </p>
      </div>
    </main>
  )
}
