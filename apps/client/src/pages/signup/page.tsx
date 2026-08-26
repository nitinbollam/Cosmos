import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { PlerosLogo } from '@/components/pleros-logo'

const FIELD_CONFIG: Array<{
  key: 'companyName' | 'slug' | 'email' | 'password' | 'firstName' | 'lastName'
  label: string
  placeholder: string
  type: string
  minLength?: number
}> = [
  { key: 'companyName', label: 'Company name', placeholder: 'e.g. Acme Distribution', type: 'text' },
  { key: 'slug', label: 'Workspace URL slug', placeholder: 'e.g. acme-dist', type: 'text' },
  { key: 'email', label: 'Work email', placeholder: 'you@company.com', type: 'email' },
  { key: 'password', label: 'Password', placeholder: '10+ characters (letters & numbers)', type: 'password', minLength: 10 },
  { key: 'firstName', label: 'First name', placeholder: 'Jane', type: 'text' },
  { key: 'lastName', label: 'Last name', placeholder: 'Doe', type: 'text' },
]

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
        email?: string
        verifyUrl?: string
        message?: string
      }
      if (!res.ok) throw new Error(data.message ?? 'Signup failed')
      if (data.requiresVerification) {
        setVerifyState({
          email: data.email ?? form.email,
          verifyUrl: data.verifyUrl,
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
              fontSize: 26,
              color: 'var(--c-heading)',
              margin: '16px 0 0',
            }}
          >
            Start your workspace
          </h1>
          <p style={{ color: 'var(--c-text-2)', fontSize: 14, marginTop: 8 }}>
            Create a new distributor tenant on Pleros
          </p>
        </div>

        {verifyState ? (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--c-text-2)' }}>
              We sent a verification link to <strong>{verifyState.email}</strong>. Confirm your email, then sign in to
              finish setup.
            </p>
            {verifyState.verifyUrl ? (
              <div
                className="rounded-lg p-3 space-y-2"
                style={{ background: 'var(--c-surface-2)', border: '1px solid var(--c-border)' }}
              >
                <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                  Email provider not configured — open this verification link to continue testing:
                </p>
                <a href={verifyState.verifyUrl} className="text-sm break-all" style={{ color: 'var(--c-accent)' }}>
                  {verifyState.verifyUrl}
                </a>
                <Link
                  to={verifyState.verifyUrl.replace(/^https?:\/\/[^/]+/, '')}
                  className="btn-primary w-full inline-block text-center"
                >
                  Verify email now
                </Link>
              </div>
            ) : (
              <Link to="/verify-email" className="btn-primary w-full inline-block text-center">
                Open verification page
              </Link>
            )}
            <div className="text-center pt-2">
              <Link to="/admin/login" className="text-sm" style={{ color: 'var(--c-accent)' }}>
                ← Go to sign in
              </Link>
            </div>
          </div>
        ) : (
          <>
            <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {FIELD_CONFIG.map(({ key, label, placeholder, type, minLength }) => (
                <div key={key}>
                  <label className="text-xs block mb-1 font-medium" style={{ color: 'var(--c-text-3)' }}>
                    {label}
                  </label>
                  <input
                    className="pleros-input w-full"
                    placeholder={placeholder}
                    type={type}
                    minLength={minLength}
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    required
                  />
                </div>
              ))}

              <label className="flex items-start gap-2 text-xs pt-1" style={{ color: 'var(--c-text-2)' }}>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  style={{ marginTop: 2 }}
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

              {error ? (
                <p style={{ color: 'var(--c-danger)', fontSize: 13, margin: '4px 0 0' }}>{error}</p>
              ) : null}

              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%', marginTop: 8 }}
                disabled={loading}
              >
                {loading ? 'Creating workspace…' : 'Create workspace'}
              </button>
            </form>

            <div className="text-center mt-6 pt-4 border-t" style={{ borderColor: 'var(--c-border)' }}>
              <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
                Already have an account?{' '}
                <Link to="/login" style={{ color: 'var(--c-accent)', fontWeight: 600 }}>
                  Sign in
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
