import { Link } from 'react-router-dom'

const PORTALS = [
  { href: '/admin', title: 'Admin', desc: 'ERP operations — inventory, orders, finance, dispatch' },
  { href: '/catalog', title: 'B2B Shop', desc: 'Buyer catalog, cart, checkout, quotes' },
  { href: '/m/warehouse', title: 'Warehouse (PWA)', desc: 'Pick tasks, receiving, offline-friendly' },
  { href: '/m/delivery', title: 'Delivery (PWA)', desc: 'Routes, POD, driver location' },
  { href: '/m/sales', title: 'Sales (PWA)', desc: 'Leads, customers, field activities' },
] as const

export default function HomePage() {
  return (
    <main className="cosmos-hub">
      <div>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.75rem', fontWeight: 700 }}>Cosmos</h1>
        <p style={{ margin: '0 0 24px', color: 'var(--c-text-2)' }}>
          Minimal ERP — admin, shop, and field mobile
        </p>
        <div className="cosmos-hub-grid">
          {PORTALS.map((p) => (
            <Link key={p.href} to={p.href} className="cosmos-hub-card">
              <h2>{p.title}</h2>
              <p>{p.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
