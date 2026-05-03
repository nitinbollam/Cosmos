import Link from 'next/link'

export default function Landing() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 22px', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 36, letterSpacing: -0.03 }}>Cosmos B2B</h1>
      <p style={{ color: '#94a3b8', marginTop: 16 }}>
        Sign in with your Cosmos tenant credentials, then review storefront quotes surfaced from{' '}
        <span style={{ fontFamily: 'monospace', color: '#c7d2fe' }}>storefront-service</span>.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 36 }}>
        <Link
          href="/login"
          style={{
            padding: '12px 22px',
            borderRadius: 999,
            background: '#4f46e5',
            color: '#fff',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Sign in
        </Link>
        <Link href="/quotes" style={{ padding: '12px 22px', color: '#a5b4fc' }}>
          View quotes →
        </Link>
      </div>
    </main>
  )
}
