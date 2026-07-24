import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { PlerosLogo } from '@/components/pleros-logo'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (e: unknown) {
      setErr(axiosErr(e))
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
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, color: 'var(--c-heading)', margin: '16px 0 0' }}>
            Reset your password
          </h1>
          <p style={{ color: 'var(--c-text-2)', fontSize: 14, marginTop: 8 }}>
            We&rsquo;ll email you a link to choose a new one
          </p>
        </div>
        {sent ? (
          <p style={{ color: 'var(--c-text-2)', fontSize: 14, textAlign: 'center' }}>
            If an account exists for <strong>{email}</strong>, a reset link is on its way. The link expires in 30
            minutes.
          </p>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="pleros-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              placeholder="Email"
            />
            <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        {err ? <p style={{ marginTop: 16, color: 'var(--c-danger)', fontSize: 14 }}>{err}</p> : null}
        <p style={{ marginTop: 20, textAlign: 'center' }}>
          <Link to="/login" style={{ color: 'var(--c-accent)', fontSize: 13 }}>
            ← Back to sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
