import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { LandingNav } from '@/components/landing-nav'

const ROLE_STARTS = [
  { label: 'Office & finance', href: '/admin/login', hint: 'Orders, inventory, AR/AP' },
  { label: 'B2B buyer', href: '/login', hint: 'Catalog, checkout, invoices' },
  { label: 'Warehouse staff', href: '/m/login', hint: 'Pick, receive, counts' },
  { label: 'Driver', href: '/m/login', hint: 'Routes & proof of delivery' },
  { label: 'Field sales', href: '/m/login', hint: 'Leads & customer visits' },
] as const

const MODULES = [
  {
    title: 'Orders & B2B',
    desc: 'Portal checkout, contract pricing, quotes, backorders, drop-ship, and split shipments.',
    items: ['Order saga & fulfillment', 'Credit limits', 'RMA & credit memos'],
  },
  {
    title: 'Inventory & WMS',
    desc: 'Multi-warehouse stock, lot tracking, directed putaway, wave picking, and cycle counts.',
    items: ['Low-stock alerts', 'Demand-based replenishment', 'Mobile pick & receive'],
  },
  {
    title: 'Finance',
    desc: 'GL, invoicing, vendor bills, bank reconciliation, and auto-posting on ship and receive.',
    items: ['AR & AP', '3-way match', 'Cashflow forecasting'],
  },
  {
    title: 'Purchasing',
    desc: 'Suppliers, purchase orders, landed costs on receive, and goods-to-stock flow.',
    items: ['PO receiving', 'Landed cost allocation', 'Vendor payments'],
  },
  {
    title: 'CRM & pricing',
    desc: 'Customers, leads, activities, volume breaks, and per-customer SKU pricing.',
    items: ['Contract prices', 'Quote approval', 'Customer portal'],
  },
  {
    title: 'Integrations',
    desc: 'Trading-partner EDI (850/810/856), webhooks, Stripe payments, and MSA compliance.',
    items: ['EDI order ingest', 'Outbound invoices & ASN', 'Compliance reports'],
  },
] as const

const WORKSPACES = [
  {
    href: '/admin',
    login: '/admin/login',
    title: 'Admin ERP',
    role: 'Operations, finance, managers',
    desc: 'Full back-office: dashboard, orders, inventory, warehouse, purchasing, dispatch, finance, POS, and settings.',
    features: ['Celestial AI copilot', 'Global search', 'Audit log'],
    accent: 'var(--c-primary)',
  },
  {
    href: '/catalog',
    login: '/login',
    title: 'B2B Shop',
    role: 'Buyer customers',
    desc: 'Self-service catalog with cart, checkout, order history, invoices, quotes, and saved payment methods.',
    features: ['Contract pricing', 'Reorder templates', 'Shipment tracking'],
    accent: 'var(--c-accent)',
  },
  {
    href: '/m/warehouse',
    login: '/m/login',
    title: 'Warehouse app',
    role: 'Pickers & receivers',
    desc: 'Mobile-friendly PWA for pick tasks, bin locations, receiving, and wave picking — works on the floor.',
    features: ['Offline-friendly', 'Barcode scans', 'Putaway tasks'],
    accent: 'var(--c-success)',
  },
  {
    href: '/m/delivery',
    login: '/m/login',
    title: 'Delivery app',
    role: 'Drivers',
    desc: 'Daily routes, stop reorder, failed delivery notes, and proof-of-delivery capture.',
    features: ['Route stops', 'POD photos', 'Status updates'],
    accent: 'var(--c-text-3)',
  },
  {
    href: '/m/sales',
    login: '/m/login',
    title: 'Sales app',
    role: 'Field reps',
    desc: 'Leads, customer lookup, and activity logging while visiting accounts.',
    features: ['Lead pipeline', 'Visit notes', 'Quick customer search'],
    accent: 'var(--c-warning)',
  },
] as const

const FLOW = [
  { step: '1', title: 'Sell', text: 'Buyers order online, reps enter orders, or staff ring up POS sales.' },
  { step: '2', title: 'Fulfill', text: 'Warehouse picks, packs, and ships — with optional lot, batch, and putaway.' },
  { step: '3', title: 'Deliver', text: 'Drivers complete routes and capture proof of delivery on mobile.' },
  { step: '4', title: 'Get paid', text: 'Invoices issue on ship; finance tracks AR, AP, and GL automatically.' },
] as const

export default function HomePage() {
  return (
    <main className="cosmos-landing">
      <div className="cosmos-landing-ambient" aria-hidden="true">
        <span className="cosmos-landing-orb cosmos-landing-orb--1" />
        <span className="cosmos-landing-orb cosmos-landing-orb--2" />
      </div>

      <header className="cosmos-landing-header">
        <Link to="/" className="cosmos-landing-logo">
          <span className="cosmos-landing-logo-mark" aria-hidden="true" />
          Cosmos
        </Link>
        <LandingNav />
      </header>

      <section className="cosmos-landing-hero">
        <div className="cosmos-landing-hero-copy">
          <p className="cosmos-landing-eyebrow">ERP for wholesale distributors</p>
          <h1 className="cosmos-landing-headline">
            Everything your distribution business needs — office, warehouse, shop, and field.
          </h1>
          <p className="cosmos-landing-lede">
            Cosmos is a modern platform for SMB wholesalers: order-to-cash, procure-to-pay, multi-warehouse
            inventory, B2B self-service, mobile warehouse & delivery, and Celestial AI to answer questions and
            look up live data.
          </p>
          <div className="cosmos-landing-hero-actions">
            <Link to="/signup" className="cosmos-landing-btn cosmos-landing-btn--primary">
              Create account
            </Link>
            <Link to="/catalog" className="cosmos-landing-btn cosmos-landing-btn--ghost">
              Browse B2B catalog
            </Link>
          </div>
        </div>

        <aside className="cosmos-landing-quickstart" aria-label="Start by role">
          <p className="cosmos-landing-quickstart-title">Start here</p>
          <ul className="cosmos-landing-quickstart-list">
            {ROLE_STARTS.map((r) => (
              <li key={r.label}>
                <Link to={r.href} className="cosmos-landing-quickstart-link">
                  <span className="cosmos-landing-quickstart-label">{r.label}</span>
                  <span className="cosmos-landing-quickstart-hint">{r.hint}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="cosmos-landing-demo-note">
            <strong>Demo:</strong> Admin <code>admin@cosmos.local</code> / <code>admin1234</code> · Buyer{' '}
            <code>buyer@acme-retail.com</code> / <code>buyer1234</code>
          </p>
        </aside>
      </section>

      <section id="features" className="cosmos-landing-features">
        <div className="cosmos-landing-section-head">
          <h2 className="cosmos-landing-section-title">What&apos;s included</h2>
          <p className="cosmos-landing-section-sub">
            Core modules wired together — not separate tools stitched with exports.
          </p>
        </div>
        <div className="cosmos-landing-feature-grid">
          {MODULES.map((m) => (
            <article key={m.title} className="cosmos-landing-feature-card">
              <h3 className="cosmos-landing-feature-title">{m.title}</h3>
              <p className="cosmos-landing-feature-desc">{m.desc}</p>
              <ul className="cosmos-landing-feature-list">
                {m.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="cosmos-landing-celestial">
        <div className="cosmos-landing-celestial-inner">
          <div>
            <p className="cosmos-landing-eyebrow">Built-in AI</p>
            <h2 className="cosmos-landing-section-title">Meet Celestial</h2>
            <p className="cosmos-landing-celestial-text">
              Ask how features work, find pending orders, check stock, or get warehouse counts — in plain
              language. Celestial combines live tenant data with platform documentation.
            </p>
          </div>
          <Link to="/admin/celestial" className="cosmos-landing-btn cosmos-landing-btn--primary">
            Open Celestial
          </Link>
        </div>
      </section>

      <section className="cosmos-landing-flow" aria-label="How Cosmos works">
        <div className="cosmos-landing-section-head">
          <h2 className="cosmos-landing-section-title">How it flows</h2>
          <p className="cosmos-landing-section-sub">From first order to cash in the bank</p>
        </div>
        <ol className="cosmos-landing-flow-list">
          {FLOW.map((f) => (
            <li key={f.step} className="cosmos-landing-flow-item">
              <span className="cosmos-landing-flow-step">{f.step}</span>
              <div>
                <p className="cosmos-landing-flow-title">{f.title}</p>
                <p className="cosmos-landing-flow-text">{f.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="workspaces" className="cosmos-landing-workspaces">
        <div className="cosmos-landing-section-head">
          <h2 className="cosmos-landing-section-title">Workspaces</h2>
          <p className="cosmos-landing-section-sub">Each role has its own surface — same data, right tools</p>
        </div>
        <ul className="cosmos-landing-ws-grid">
          {WORKSPACES.map((w) => (
            <li key={w.href}>
              <article
                className="cosmos-landing-ws-card"
                style={{ '--card-accent': w.accent } as CSSProperties}
              >
                <span className="cosmos-landing-card-bar" aria-hidden="true" />
                <p className="cosmos-landing-ws-role">{w.role}</p>
                <h3 className="cosmos-landing-ws-title">{w.title}</h3>
                <p className="cosmos-landing-ws-desc">{w.desc}</p>
                <ul className="cosmos-landing-ws-features">
                  {w.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <div className="cosmos-landing-ws-actions">
                  <Link to={w.href} className="cosmos-landing-ws-open">
                    Open workspace →
                  </Link>
                  <Link to={w.login} className="cosmos-landing-ws-signin">
                    Sign in
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </section>

      <footer className="cosmos-landing-footer">
        <div className="cosmos-landing-footer-grid">
          <div>
            <p className="cosmos-landing-footer-brand">Cosmos</p>
            <p className="cosmos-landing-footer-tag">
              Modern ERP for US SMB wholesalers · B2B-heavy · 1–few warehouses
            </p>
          </div>
          <div className="cosmos-landing-footer-links">
            <Link to="/admin">Admin</Link>
            <Link to="/catalog">Shop</Link>
            <Link to="/signup">Sign up</Link>
            <Link to="/admin/login">Admin login</Link>
          </div>
        </div>
        <p className="cosmos-landing-footer-copy">© {new Date().getFullYear()} Cosmos</p>
      </footer>
    </main>
  )
}
