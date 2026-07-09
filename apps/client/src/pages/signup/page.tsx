import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'

export default function SignupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    companyName: '',
    slug: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [verifyState, setVerifyState] = useState<{
    email: string
    verifyUrl?: string
    autoVerified?: boolean
  } | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed) {
      setError('Please agree to the Terms of Service and Privacy Policy')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = (await res.json()) as {
        accessToken?: string
        refreshToken?: string
        requiresVerification?: boolean
        autoVerified?: boolean
        email?: string
        verifyUrl?: string
        message?: string
      }
      if (!res.ok) throw new Error(data.message ?? 'Signup failed')
      if (data.autoVerified || data.requiresVerification) {
        setVerifyState({
          email: data.email ?? form.email,
          verifyUrl: data.verifyUrl,
          autoVerified: Boolean(data.autoVerified),
        })
        return
      }
      if (data.accessToken) localStorage.setItem('pleros.accessToken', data.accessToken)
      if (data.refreshToken) localStorage.setItem('pleros.refreshToken', data.refreshToken)
      navigate('/admin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pleros-auth-page" style={{ display: 'block', paddingTop: 48 }}>
      <AuthThemeToolbar />
      <div className="mx-auto max-w-md p-8">
        <h1 className="text-2xl font-semibold mb-2">Start your Pleros workspace</h1>
        {verifyState ? (
          <div className="space-y-4">
            {verifyState.autoVerified ? (
              <>
                <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
                  Account created for <strong>{verifyState.email}</strong>. Email verification was skipped in local
                  development (no SendGrid configured). Sign in to finish onboarding.
                </p>
                <Link to="/admin/login" className="pleros-btn pleros-btn-primary w-full inline-block text-center">
                  Sign in to continue
                </Link>
              </>
            ) : (
              <>
                <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
                  {verifyState.verifyUrl ? (
                    'No email provider is configured, so use the verification link below (also printed in the server console).'
                  ) : (
                    <>
                      We sent a verification link to <strong>{verifyState.email}</strong>. Confirm your email, then sign
                      in to finish setup.
                    </>
                  )}
                </p>
                {verifyState.verifyUrl ? (
                  <div
                    className="rounded-lg p-3 space-y-2"
                    style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}
                  >
                    <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                      Dev verification link
                    </p>
                    <a href={verifyState.verifyUrl} className="text-sm break-all" style={{ color: 'var(--c-accent)' }}>
                      {verifyState.verifyUrl}
                    </a>
                    <Link
                      to={verifyState.verifyUrl.replace(/^https?:\/\/[^/]+/, '')}
                      className="pleros-btn pleros-btn-primary w-full inline-block text-center"
                    >
                      Verify email now
                    </Link>
                  </div>
                ) : (
                  <Link to="/verify-email" className="pleros-btn pleros-btn-primary w-full inline-block text-center">
                    Open verification page
                  </Link>
                )}
                <Link to="/admin/login" className="text-sm" style={{ color: 'var(--c-accent)' }}>
                  Go to sign in
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm mb-6" style={{ color: 'var(--c-text-3)' }}>
              Create a new distributor tenant. Already have an account? <Link to="/login">Sign in</Link>
            </p>
            <form onSubmit={onSubmit} className="space-y-3">
              {(['companyName', 'slug', 'email', 'password', 'firstName', 'lastName'] as const).map((key) => (
                <input
                  key={key}
                  className="pleros-input w-full"
                  placeholder={
                    key === 'slug'
                      ? 'company-slug'
                      : key === 'password'
                        ? 'password (10+ chars, letter + number)'
                        : key.replace(/([A-Z])/g, ' $1')
                  }
                  type={key === 'password' ? 'password' : key === 'email' ? 'email' : 'text'}
                  minLength={key === 'password' ? 10 : undefined}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  required
                />
              ))}
              <label className="flex items-start gap-2 text-sm" style={{ color: 'var(--c-text-2)' }}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  I agree to the{' '}
                  <Link to="/terms" style={{ color: 'var(--c-accent)' }}>
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link to="/privacy" style={{ color: 'var(--c-accent)' }}>
                    Privacy Policy
                  </Link>
                </span>
              </label>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button type="submit" className="pleros-btn pleros-btn-primary w-full" disabled={loading}>
                {loading ? 'Creating…' : 'Create workspace'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
