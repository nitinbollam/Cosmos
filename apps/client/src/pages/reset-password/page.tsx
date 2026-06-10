import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AuthThemeToolbar } from '@/components/auth-theme-toolbar'
import { CosmosLogo } from '@/components/cosmos-logo'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
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
      await api.post('/auth/reset-password', { token, password })
      setDone(true)
    } catch (e: unknown) {
      setErr(axiosErr(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="cosmos-auth-page">
      <AuthThemeToolbar />
      <div className="cosmos-card cosmos-auth-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', justifyContent: 'center' }}>
            <CosmosLogo size="lg" />
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, color: 'var(--c-heading)', margin: '16px 0 0' }}>
            Choose a new password
          </h1>
          <p style={{ color: 'var(--c-text-2)', fontSize: 14, marginTop: 8 }}>
            At least 10 characters with a letter and a number
          </p>
        </div>
        {!token ? (
          <p style={{ color: 'var(--c-danger)', fontSize: 14, textAlign: 'center' }}>
            This reset link is missing its token. Request a new one from the sign-in page.
          </p>
        ) : done ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--c-text-2)', fontSize: 14 }}>Your password has been updated.</p>
            <Link to="/login" className="btn-primary" style={{ display: 'inline-block', marginTop: 16 }}>
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="cosmos-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              minLength={10}
              placeholder="New password"
            />
            <input
              className="cosmos-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              type="password"
              required
              minLength={10}
              placeholder="Confirm new password"
            />
            <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Saving…' : 'Update password'}
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
