import Link from 'next/link'

export default function Landing() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '48px 22px',
        lineHeight: 1.5,
        background: 'var(--c-bg)',
        color: 'var(--c-text)',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, letterSpacing: -0.03, color: 'var(--c-white)' }}>Cosmos B2B</h1>
      <p style={{ color: 'var(--c-text-2)', marginTop: 16 }}>
        Sign in, browse the catalog, check out as your CRM customer, and track orders on the B2B portal.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 36 }}>
        <Link href="/login" className="btn-primary" style={{ textDecoration: 'none' }}>
          Sign in
        </Link>
        <Link href="/catalog" style={{ padding: '12px 22px', color: 'var(--c-accent)' }}>
          Catalog →
        </Link>
        <Link href="/orders" style={{ padding: '12px 22px', color: 'var(--c-accent)' }}>
          Orders →
        </Link>
        <Link href="/quotes" style={{ padding: '12px 22px', color: 'var(--c-accent)' }}>
          Quotes →
        </Link>
      </div>
    </main>
  )
}
