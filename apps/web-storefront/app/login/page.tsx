'use client'

import Link from 'next/link'
import { useState } from 'react'
import { api } from '@/lib/api'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      const r = await api.post<{ accessToken: string; refreshToken: string }>('/auth/login', {
        email,
        password,
      })
      window.localStorage.setItem('cosmos.accessToken', r.accessToken)
      window.localStorage.setItem('cosmos.refreshToken', r.refreshToken)
      window.location.href = '/quotes'
    } catch (e: unknown) {
      setErr((e as Error).message ?? 'Login failed')
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '64px auto', padding: '0 20px', color: '#e2e8f0' }}>
      <Link href="/" style={{ color: '#a5b4fc', fontSize: 13 }}>
        ← Back
      </Link>
      <h1 style={{ marginTop: 24 }}>B2B sign in</h1>
      <form onSubmit={submit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          placeholder="email"
          style={inputStyle}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          placeholder="password"
          style={inputStyle}
        />
        <button type="submit" style={btn}>
          Continue
        </button>
      </form>
      {err && (
        <p style={{ marginTop: 12, color: '#f97316', fontSize: 13 }}>{err}</p>
      )}
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#13131f',
  border: '1px solid #2b2f45',
  borderRadius: 10,
  color: '#e2e8f0',
  padding: '12px 14px',
  outline: 'none',
}

const btn: React.CSSProperties = {
  marginTop: 8,
  padding: '12px 14px',
  borderRadius: 10,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontWeight: 700,
}
