'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Quote = {
  id: string
  status: string
  customerRef: string
  notes?: string | null
  createdAt?: string
}

export default function QuotesPage() {
  const [rows, setRows] = useState<Quote[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const data = await api.get<Quote[]>('/quotes')
        setRows(data)
      } catch (e) {
        setErr((e as Error).message ?? 'Could not fetch quotes — sign in required?')
      }
    })()
  }, [])

  return (
    <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 20px', color: '#f8fafc' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1>Quotes</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
          <Link href="/quotes/new" style={{ color: '#93c5fd' }}>
            + New quote →
          </Link>
          <Link href="/login" style={{ color: '#93c5fd' }}>
            Re-authenticate →
          </Link>
        </div>
      </div>
      {err ? <p style={{ color: '#fca5a5' }}>{err}</p> : null}
      {rows?.length === 0 && <p style={{ color: '#94a3b8', marginTop: 16 }}>No quotes yet — try New quote.</p>}
      <ul style={{ padding: 0, listStyle: 'none', marginTop: 20 }}>
        {(rows ?? []).map((q) => (
          <li
            key={q.id}
            style={{
              border: '1px solid #1f2740',
              borderRadius: 12,
              padding: 14,
              marginBottom: 10,
              background: '#0d0d16',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <Link href={`/quotes/${q.id}`} style={{ fontFamily: 'monospace', fontSize: 12, color: '#c7d2fe', textDecoration: 'none' }}>
              {q.id.slice(0, 14)}… →
            </Link>
            <div>{q.customerRef}</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              Status <strong>{q.status}</strong>
            </div>
          </li>
        ))}
      </ul>
      {!rows && !err ? <p style={{ color: '#94a3b8' }}>Loading…</p> : null}
    </main>
  )
}
