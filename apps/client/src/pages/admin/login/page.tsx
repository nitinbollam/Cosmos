import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { PlerosLogo } from '@/components/pleros-logo'
import { api, formatApiReachabilityError } from '@/lib/api-admin'
import { axiosErr, isEmailVerificationRequired, isUnauthorized } from '@/lib/axios-error'
import { emitStorefrontAuthChanged } from '@/lib/auth-events'
import { setTokens } from '@/lib/auth-session'
import { tenantPromptOf, tokensOf, type LoginResponse, type LoginTokens, type TenantPrompt } from '@/lib/login-flow'
import { TenantPicker } from '@/components/auth/tenant-picker'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [resendSent, setResendSent] = useState(false)
  const [resendBusy, setResendBusy] = useState(false)
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null)
  const [pick, setPick] = useState<TenantPrompt | null>(null)

  function finish(r: LoginTokens) {
    setTokens(r.accessToken, r.refreshToken)
    emitStorefrontAuthChanged()
    const next = new URLSearchParams(window.location.search).get('next')
    navigate(next?.startsWith('/') ? next : '/admin')
  }

  async function choose(tenantId: string) {
    if (!pick) return
    setErr(null)
    setLoading(true)
    try {
      finish(await api.post<LoginTokens>('/auth/login/select', { selectionToken: pick.selectionToken, tenantId }))
    } catch (e) {
      if (isUnauthorized(e)) setPick(null)
      setErr(isEmailVerificationRequired(e) ? 'Please verify your email before signing in.' : formatApiReachabilityError(e) || axiosErr(e))
    } finally {
      setLoading(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setNeedsVerification(false)
    setResendSent(false)
    setDevVerifyUrl(null)
    setLoading(true)
    try {
      const r = await api.post<LoginResponse>('/auth/login', { email, password })
      const prompt = tenantPromptOf(r)
      if (prompt) {
        setPick(prompt)
        return
      }
      finish(tokensOf(r))
    } catch (e) {
      if (isEmailVerificationRequired(e)) {
        setNeedsVerification(true)
        setErr('Please verify your email before signing in.')
      } else {
        setErr(formatApiReachabilityError(e) || axiosErr(e))
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
    } catch (e) {
      setErr(formatApiReachabilityError(e) || axiosErr(e))
    } finally {
      setResendBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--c-bg)' }}>
      <AuthThemeToolbar />
      <form onSubmit={submit} className="bento-cell bento-tone-white w-full max-w-sm space-y-4">
        <div className="flex justify-center pb-2">
          <PlerosLogo size="lg" />
        </div>
        <div>
          <p className="bento-kpi-label">Admin</p>
          <h1 className="bento-hero-title mt-2" style={{ fontSize: '1.5rem' }}>
            Sign in
          </h1>
          <p className="bento-section-sub">Access your distribution command center</p>
        </div>
        {pick ? (
          <TenantPicker
            email={email.trim()}
            tenants={pick.tenants}
            busy={loading}
            error={err}
            onPick={(id) => void choose(id)}
            onBack={() => {
              setPick(null)
              setPassword('')
              setErr(null)
            }}
          />
        ) : (
          <>
        <input className="pleros-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="pleros-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <p className="text-sm font-medium" style={{ color: 'var(--c-danger)' }}>{err}</p>}
        {needsVerification ? (
          <div className="rounded-lg p-3 space-y-3" style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}>
            <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
              Check your inbox for the verification link, or request a new one.
            </p>
            <Link
              to={`/verify-email${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}
              className="text-sm font-medium"
              style={{ color: 'var(--c-accent)' }}
            >
              Open verification page →
            </Link>
            <button
              type="button"
              className="btn-ghost w-full"
              disabled={resendBusy || !email.trim()}
              onClick={() => void resendVerification()}
            >
              {resendBusy ? 'Sending…' : 'Resend verification email'}
            </button>
            {resendSent ? (
              <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                {devVerifyUrl
                  ? 'Email provider not configured — use the verification link below.'
                  : 'If an unverified account exists for that address, a new link was sent.'}
              </p>
            ) : null}
            {devVerifyUrl ? (
              <div className="space-y-2">
                <a href={devVerifyUrl} className="text-xs break-all" style={{ color: 'var(--c-accent)' }}>
                  {devVerifyUrl}
                </a>
                <Link
                  to={devVerifyUrl.replace(/^https?:\/\/[^/]+/, '')}
                  className="btn-primary w-full inline-block text-center text-sm"
                >
                  Verify email now
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Continue'}
        </button>
          </>
        )}
        <p className="text-center">
          <a href="/forgot-password" className="text-sm" style={{ color: 'var(--c-accent)' }}>
            Forgot password?
          </a>
        </p>
      </form>
    </div>
  )
}
