import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = (await res.json()) as { accessToken?: string; message?: string }
      if (!res.ok) throw new Error(data.message ?? 'Signup failed')
      if (data.accessToken) localStorage.setItem('cosmos.accessToken', data.accessToken)
      navigate('/admin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold mb-2">Start your Cosmos workspace</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--c-text-3)' }}>
        Create a new distributor tenant. Already have an account? <Link to="/login">Sign in</Link>
      </p>
      <form onSubmit={onSubmit} className="space-y-3">
        {(['companyName', 'slug', 'email', 'password', 'firstName', 'lastName'] as const).map((key) => (
          <input
            key={key}
            className="cosmos-input w-full"
            placeholder={key === 'slug' ? 'company-slug' : key.replace(/([A-Z])/g, ' $1')}
            type={key === 'password' ? 'password' : 'text'}
            value={form[key]}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            required
          />
        ))}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button type="submit" className="cosmos-btn cosmos-btn-primary w-full" disabled={loading}>
          {loading ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </div>
  )
}
