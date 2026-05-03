'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setLoading(true)
    try {
      const r = await api.post<{ accessToken: string; refreshToken: string }>('/auth/login', { email, password })
      window.localStorage.setItem('cosmos.accessToken', r.accessToken)
      window.localStorage.setItem('cosmos.refreshToken', r.refreshToken)
      router.push('/')
    } catch (e) {
      setErr((e as Error).message ?? 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="cosmos-card w-full max-w-sm p-6 space-y-4">
        <h1 className="text-cosmos-white text-2xl font-semibold">Sign in to Cosmos</h1>
        <input
          className="w-full bg-cosmos-surface-2 border border-cosmos-border rounded-md px-3 h-10 text-cosmos-white"
          placeholder="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="w-full bg-cosmos-surface-2 border border-cosmos-border rounded-md px-3 h-10 text-cosmos-white"
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {err && <p className="text-cosmos-danger text-sm">{err}</p>}
        <button
          type="submit"
          className="w-full h-10 rounded-md bg-cosmos-primary text-white font-medium disabled:opacity-50"
          disabled={loading}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
