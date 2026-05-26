import Image from '@/components/cosmos-img'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { api } from '@/lib/api'
import { axiosErr } from '@/lib/axios-error'
import { emitStorefrontAuthChanged } from '@/lib/auth-events'
import { parseJwtPayload } from '@/lib/jwt'
import { setB2bSession } from '@/lib/session'

type LoginRes = { accessToken: string; refreshToken: string }

type CustomerRow = { id: string; name: string; email?: string | null }

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      const r = await api.post<LoginRes>('/auth/login', { email, password })
      window.localStorage.setItem('cosmos.accessToken', r.accessToken)
      window.localStorage.setItem('cosmos.refreshToken', r.refreshToken)

      const payload = parseJwtPayload(r.accessToken)
      const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
      const jwtMail = typeof payload?.email === 'string' ? payload.email.toLowerCase() : email.toLowerCase()
      if (!tenantId) {
        setErr('Token missing tenant. Contact support.')
        return
      }

      const customers = await api.get<CustomerRow[]>('/customers')
      const match = customers.find((c) => c.email?.toLowerCase() === jwtMail)
      if (!match) {
        setErr(
          'No CRM customer record matches your email. Ask your tenant admin to create a customer with this address.',
        )
        window.localStorage.removeItem('cosmos.accessToken')
        window.localStorage.removeItem('cosmos.refreshToken')
        return
      }

      setB2bSession(tenantId, match.id)
      emitStorefrontAuthChanged()
      window.location.href = '/catalog'
    } catch (e: unknown) {
      setErr(axiosErr(e))
    }
  }

  return (
    <main className="cosmos-auth-page">
      <div className="cosmos-card cosmos-auth-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Image src="/cosmos-logo.png" alt="" width={120} height={60} style={{ height: 60, width: 'auto' }} priority />
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, color: 'var(--c-heading)', margin: '16px 0 0' }}>
            Welcome back
          </h1>
          <p style={{ color: 'var(--c-text-2)', fontSize: 14, marginTop: 8 }}>B2B buyer portal</p>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="cosmos-input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="Email" />
          <input
            className="cosmos-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
            placeholder="Password"
          />
          <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: 8 }}>
            Sign In
          </button>
        </form>
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
