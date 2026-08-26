import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { LandingNav } from '@/components/landing-nav'
import { PlerosLogo } from '@/components/pleros-logo'
import { getSessionUser, isSignedIn } from '@/lib/auth-session'

type RolePortal = {
  id: string
  title: string
  subtitle: string
  badge: string
  icon: string
  href: string
  loginHref: string
  demoRole: string
  color: string
  description: string
  highlights: string[]
  metrics: { label: string; val: string }[]
}

const ROLE_PORTALS: RolePortal[] = [
  {
    id: 'admin',
    title: 'Back-Office ERP',
    subtitle: 'Operations, Finance & Executive Hub',
    badge: 'Full Platform Access',
    icon: '🏢',
    href: '/admin',
    loginHref: '/admin/login',
    demoRole: 'Admin / Manager',
    color: 'var(--c-primary)',
    description: 'Complete centralized control of orders, multi-warehouse stock, purchase orders, general ledger, and global platform search.',
    highlights: ['Multi-Warehouse Control', 'Automated GL Accounting', 'Celestial AI Copilot', 'Customer Price Books'],
    metrics: [
      { label: 'Modules', val: '12 Active' },
      { label: 'Reconciliation', val: '3-Way Match' },
      { label: 'Ledger', val: 'Real-Time' },
    ],
  },
  {
    id: 'b2b',
    title: 'B2B Buyer Shop',
    subtitle: 'Self-Service Customer Storefront',
    badge: 'Contract & Tier Pricing',
    icon: '🛍️',
    href: '/catalog',
    loginHref: '/login',
    demoRole: 'Wholesale Buyer',
    color: 'var(--c-accent)',
    description: 'Customer portal with contract pricing, quick stock availability, order tracking, invoice history, and 1-click reordering.',
    highlights: ['Stock-Aware Catalog', 'Instant Reorder Lines', 'Invoice Tracking', 'Custom Price Tiers'],
    metrics: [
      { label: 'Order Entry', val: 'Self-Service' },
      { label: 'Invoices', val: 'Auto-Issued' },
      { label: 'Payment', val: 'Net Terms / Card' },
    ],
  },
  {
    id: 'warehouse',
    title: 'Warehouse & WMS',
    subtitle: 'Floor Picking, Putaway & Receiving',
    badge: 'Mobile-Optimized PWA',
    icon: '📦',
    href: '/m/warehouse',
    loginHref: '/m/login',
    demoRole: 'Warehouse Staff',
    color: 'var(--c-success)',
    description: 'Fast barcode scanning and task execution for pick tasks, pick waves, dock receiving, bin mapping, and cycle counts.',
    highlights: ['Wave Picking Paths', 'Dock Receiving Scanner', 'Directed Putaway', 'Blind Cycle Counts'],
    metrics: [
      { label: 'Scans', val: 'QR & Code 128' },
      { label: 'Routing', val: 'Optimized Path' },
      { label: 'Sync', val: 'Offline Ready' },
    ],
  },
  {
    id: 'delivery',
    title: 'Route Delivery',
    subtitle: 'Driver App & Proof of Delivery',
    badge: 'Field Dispatch',
    icon: '🚚',
    href: '/m/delivery',
    loginHref: '/m/login',
    demoRole: 'Driver / Logistics',
    color: '#38bdf8',
    description: 'Driver route manifest with stop sequence optimization, turn directions, failed delivery notes, and digital photo POD capture.',
    highlights: ['Haversine Route Stops', 'Photo Proof of Delivery', 'Signature Capture', 'Live Status Sync'],
    metrics: [
      { label: 'Stops', val: 'Auto-Sequenced' },
      { label: 'POD', val: 'Digital Photo' },
      { label: 'Tracking', val: 'Real-Time' },
    ],
  },
  {
    id: 'pos',
    title: 'Point of Sale',
    subtitle: 'Counter Checkout & Retail Cashier',
    badge: 'Fast Counter Sales',
    icon: '💳',
    href: '/admin/pos',
    loginHref: '/admin/login',
    demoRole: 'Cashier / Store Rep',
    color: 'var(--c-warning)',
    description: 'Speedy counter sales with barcode lookup, instant tax calculation, compliance age checks, cash/card tenders, and receipts.',
    highlights: ['Rapid Barcode Lookup', 'Age Verification Policy', 'Digital / Print Receipts', 'Split Tender'],
    metrics: [
      { label: 'Speed', val: '< 3s Checkout' },
      { label: 'Tenders', val: 'Cash / Card' },
      { label: 'Compliance', val: 'Attestation Built-In' },
    ],
  },
]

const MODULES = [
  {
    id: 'orders',
    title: 'Order-to-Cash & B2B',
    badge: 'Automated Saga',
    desc: 'Self-service portal, contract price books, quotes, automated backorders, drop-ship fulfillment, and split shipments.',
    items: ['Automated order saga', 'Customer credit limits', 'RMA & credit memos', 'Custom volume tiers'],
  },
  {
    id: 'wms',
    title: 'Inventory & Multi-Warehouse',
    badge: 'Real-Time Stock',
    desc: 'Multi-facility inventory tracking, lot & batch expiration control, directed putaway, wave picking, and cycle counting.',
    items: ['Demand replenishment (EWMA)', 'Stock-aware routing', 'Barcode & QR thermal labels', 'Blind cycle counts'],
  },
  {
    id: 'finance',
    title: 'Accounting & General Ledger',
    badge: 'Real-Time Posting',
    desc: 'Double-entry GL, automated invoice generation on shipment, AP vendor bills, bank reconciliations, and AR aging buckets.',
    items: ['Automated COGS posting', '3-way purchase matching', 'AR aging schedule (0–90+ d)', 'Trial balance & export'],
  },
  {
    id: 'purchasing',
    title: 'Procure-to-Pay',
    badge: 'Landed Cost',
    desc: 'Vendor management, purchase order generation, landed freight/duty allocation on dock receipt, and goods-to-stock flow.',
    items: ['PO receiving workflow', 'Duty & freight unit cost', 'Vendor bill matching', 'Lead-time tracking'],
  },
  {
    id: 'dispatch',
    title: 'Fleet Dispatch & Logistics',
    badge: 'Route Optimization',
    desc: 'Delivery manifest assignment, nearest-neighbor stop sequence calculation, mobile photo POD capture, and carrier tracking.',
    items: ['Nearest-neighbor routing', 'Photo proof of delivery', 'Customer delivery ETA', 'Multi-carrier tracking'],
  },
  {
    id: 'compliance',
    title: 'Compliance & Partner EDI',
    badge: 'Enterprise Integrations',
    desc: 'Trading-partner EDI (850 / 810 / 856), compliance MSA reporting, Stripe Connect payments, and webhook subscriptions.',
    items: ['EDI order & ASN ingest', 'Age-verification policies', 'Stripe Connect onboarding', 'Tenant audit logging'],
  },
]

const FLOW_STEPS = [
  {
    step: '01',
    title: 'Sell Across Channels',
    desc: 'B2B buyers order online, sales reps generate custom quotes, and cashiers handle walk-in counter sales on POS.',
    badge: 'B2B · POS · CRM',
  },
  {
    step: '02',
    title: 'Fulfill in Warehouse',
    desc: 'Orders allocate across warehouses. Floor staff pick via optimized wave paths, scan barcodes, and pack cartons.',
    badge: 'WMS · Wave · Barcodes',
  },
  {
    step: '03',
    title: 'Deliver & Capture POD',
    desc: 'Dispatchers optimize route sequences. Drivers follow stop turns on mobile and capture photo signatures at delivery.',
    badge: 'Fleet · Logistics · POD',
  },
  {
    step: '04',
    title: 'Post to GL & Collect Cash',
    desc: 'Invoices issue on dispatch. AR aging tracks net terms exposure and payments reconcile with general ledger entries.',
    badge: 'Real-Time GL · Stripe',
  },
]

export default function HomePage() {
  const [selectedPortal, setSelectedPortal] = useState<string>('admin')
  const user = isSignedIn() ? getSessionUser() : null
  const currentPortal = ROLE_PORTALS.find((p) => p.id === selectedPortal) ?? ROLE_PORTALS[0]!

  return (
    <main className="pleros-landing">
      <div className="pleros-landing-ambient" aria-hidden="true">
        <span className="pleros-landing-orb pleros-landing-orb--1" />
        <span className="pleros-landing-orb pleros-landing-orb--2" />
      </div>

      <header className="pleros-landing-header">
        <Link to="/" className="pleros-landing-logo">
          <PlerosLogo variant="full" size="sm" />
        </Link>
        <LandingNav />
      </header>

      {/* Hero Section */}
      <section className="pleros-landing-hero">
        <div className="pleros-landing-hero-copy">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold mb-6 border" style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface-2)', color: 'var(--c-primary)' }}>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Modern Wholesale Distribution Platform</span>
          </div>

          <h1 className="pleros-landing-headline">
            Everything your distribution business needs —{' '}
            <span className="bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
              office, warehouse, shop, and field.
            </span>
          </h1>

          <p className="pleros-landing-lede">
            Pleros unifies multi-warehouse inventory, order-to-cash, automated GL accounting, B2B self-service,
            mobile warehouse scanners, fleet delivery, and Celestial AI into one lightning-fast platform.
          </p>

          <div className="pleros-landing-hero-actions">
            {user ? (
              <Link to="/admin" className="pleros-landing-btn pleros-landing-btn--primary">
                Open Admin Workspace →
              </Link>
            ) : (
              <Link to="/signup" className="pleros-landing-btn pleros-landing-btn--primary">
                Create workspace free
              </Link>
            )}
            <Link to="/catalog" className="pleros-landing-btn pleros-landing-btn--ghost">
              Browse B2B Shop
            </Link>
            <Link to="/admin/pos" className="pleros-landing-btn pleros-landing-btn--ghost !text-xs">
              Open POS
            </Link>
          </div>

          <div className="mt-8 flex items-center gap-6 text-xs" style={{ color: 'var(--c-text-3)' }}>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-400">✓</span> No credit card required
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-400">✓</span> Instant tenant sandbox
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-emerald-400">✓</span> Multi-user RBAC
            </div>
          </div>
        </div>

        {/* Interactive Role & Portal Launchpad */}
        <aside className="pleros-card p-5 rounded-2xl border" style={{ borderColor: 'var(--c-border-card)', background: 'var(--c-surface)' }}>
          <div className="flex items-center justify-between gap-2 pb-3 mb-4 border-b" style={{ borderColor: 'var(--c-border)' }}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-pleros-text-3">Role Launchpad</p>
              <h2 className="text-base font-bold text-pleros-white">Explore by Workflow</h2>
            </div>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
              Live Preview
            </span>
          </div>

          {/* Role Tabs */}
          <div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-black/20 border mb-4" style={{ borderColor: 'var(--c-border)' }}>
            {ROLE_PORTALS.map((portal) => {
              const active = portal.id === selectedPortal
              return (
                <button
                  key={portal.id}
                  type="button"
                  onClick={() => setSelectedPortal(portal.id)}
                  className={`py-2 px-1 text-center rounded-lg text-xs font-medium transition-all ${
                    active ? 'bg-white/10 text-white shadow-sm font-semibold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                  style={active ? { borderColor: portal.color } : {}}
                >
                  <div className="text-base mb-0.5">{portal.icon}</div>
                  <div className="truncate text-[10px] sm:text-xs">{portal.title.split(' ')[0]}</div>
                </button>
              )
            })}
          </div>

          {/* Portal Card Detail */}
          <div className="rounded-xl p-4 border transition-all" style={{ background: 'var(--c-surface-2)', borderColor: 'var(--c-border)' }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: currentPortal.color }}>
                  {currentPortal.badge}
                </span>
                <h3 className="text-base font-bold text-pleros-white mt-0.5">{currentPortal.title}</h3>
                <p className="text-xs text-pleros-text-3">{currentPortal.subtitle}</p>
              </div>
              <span className="text-2xl">{currentPortal.icon}</span>
            </div>

            <p className="text-xs text-pleros-text-2 my-3 leading-relaxed">
              {currentPortal.description}
            </p>

            <div className="grid grid-cols-3 gap-2 my-3 pt-3 border-t text-center" style={{ borderColor: 'var(--c-border)' }}>
              {currentPortal.metrics.map((m) => (
                <div key={m.label} className="p-1.5 rounded-lg bg-black/20">
                  <div className="text-xs font-bold text-pleros-white">{m.val}</div>
                  <div className="text-[10px] text-pleros-text-3 mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5 mb-4">
              {currentPortal.highlights.map((h) => (
                <span key={h} className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 text-slate-300 border border-white/5">
                  • {h}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--c-border)' }}>
              <Link
                to={currentPortal.href}
                className="btn-primary flex-1 text-center !py-2 !text-xs font-semibold"
              >
                Launch {currentPortal.title} →
              </Link>
              <Link
                to={currentPortal.loginHref}
                className="btn-ghost !py-2 !px-3 !text-xs"
                title="Sign in directly to this portal"
              >
                Sign in
              </Link>
            </div>
          </div>
        </aside>
      </section>

      {/* Bento Grid Feature Modules */}
      <section id="features" className="pleros-landing-features">
        <div className="pleros-landing-section-head text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">Core Capabilities</span>
          <h2 className="pleros-landing-section-title mt-1">Built as One Unified ERP Engine</h2>
          <p className="pleros-landing-section-sub">
            No messy API glue or third-party sync delays. Order states, inventory levels, GL entries, and route stops update in real time.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {MODULES.map((m) => (
            <article
              key={m.id}
              className="pleros-card p-6 rounded-2xl border transition-all duration-200 hover:-translate-y-1 hover:border-slate-700"
              style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border-card)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-lg font-bold text-pleros-white">{m.title}</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  {m.badge}
                </span>
              </div>
              <p className="text-xs text-pleros-text-2 leading-relaxed mb-4">{m.desc}</p>
              <ul className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--c-border)' }}>
                {m.items.map((item) => (
                  <li key={item} className="text-xs flex items-center gap-2 text-pleros-text-3">
                    <span className="text-sky-400 text-sm">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* Celestial AI Banner */}
      <section className="max-w-6xl mx-auto px-4 my-16">
        <div
          className="rounded-2xl p-8 sm:p-10 border relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
            borderColor: 'rgba(56, 189, 248, 0.25)',
          }}
        >
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-sky-300 bg-sky-500/20 border border-sky-400/30 mb-3">
              ✦ Embedded Intelligence
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white font-display">Meet Celestial AI Copilot</h2>
            <p className="text-sm text-slate-300 mt-2 leading-relaxed">
              Ask natural-language questions about inventory, pending shipments, aging invoices, and system workflows.
              Celestial queries your live tenant data and answers instantly with actionable shortcuts.
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="text-xs px-2.5 py-1 rounded-full bg-black/40 text-slate-300 border border-white/10 font-mono">
                &ldquo;What SKUs are low in Dallas?&rdquo;
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-black/40 text-slate-300 border border-white/10 font-mono">
                &ldquo;Show unpaid invoices &gt; 30 days&rdquo;
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-black/40 text-slate-300 border border-white/10 font-mono">
                &ldquo;How do I start wave picking?&rdquo;
              </span>
            </div>
          </div>
          <Link
            to="/admin/celestial"
            className="btn-primary whitespace-nowrap !py-3 !px-6 text-sm font-semibold shadow-lg shadow-sky-500/20"
          >
            Launch Celestial AI →
          </Link>
        </div>
      </section>

      {/* Distribution Lifecycle Flow */}
      <section id="solutions" className="max-w-6xl mx-auto px-4 my-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">Order-to-Cash Lifecycle</span>
          <h2 className="text-2xl sm:text-3xl font-bold text-pleros-white mt-1">From First Click to Collected Cash</h2>
          <p className="text-sm text-pleros-text-3 mt-2">
            Every step is connected. No spreadsheets, manual export syncs, or broken communication.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {FLOW_STEPS.map((s) => (
            <div
              key={s.step}
              className="p-5 rounded-xl border relative"
              style={{ background: 'var(--c-surface)', borderColor: 'var(--c-border)' }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl font-black font-mono text-sky-400/80">{s.step}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-300">
                  {s.badge}
                </span>
              </div>
              <h3 className="text-base font-bold text-pleros-white mb-2">{s.title}</h3>
              <p className="text-xs text-pleros-text-2 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Workspaces Section */}
      <section id="workspaces" className="max-w-6xl mx-auto px-4 my-16">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">Dedicated Surfaces</span>
          <h2 className="text-2xl sm:text-3xl font-bold text-pleros-white mt-1">Workspaces for Every Role</h2>
          <p className="text-sm text-pleros-text-3 mt-2">
            Give each team member the exact interface and speed they need.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {ROLE_PORTALS.map((w) => (
            <div
              key={w.id}
              className="p-6 rounded-2xl border flex flex-col justify-between"
              style={{ background: 'var(--c-surface-2)', borderColor: 'var(--c-border-card)' }}
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-3xl">{w.icon}</span>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: w.color }}>
                    {w.demoRole}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-pleros-white mb-1">{w.title}</h3>
                <p className="text-xs text-pleros-text-3 mb-3">{w.subtitle}</p>
                <p className="text-xs text-pleros-text-2 mb-4 leading-relaxed">{w.description}</p>
              </div>

              <div className="pt-4 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--c-border)' }}>
                <Link to={w.href} className="text-xs font-semibold text-sky-400 hover:text-sky-300">
                  Open workspace →
                </Link>
                <Link to={w.loginHref} className="text-xs text-slate-400 hover:text-slate-200">
                  Sign in
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12 px-6 mt-20" style={{ borderColor: 'var(--c-border)', background: 'var(--c-surface)' }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <PlerosLogo variant="mark" size="sm" />
            <div>
              <p className="text-sm font-bold text-pleros-white">Pleros Platform</p>
              <p className="text-xs text-pleros-text-3">Enterprise Distribution Engine for SMB Wholesalers</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-pleros-text-3">
            <Link to="/admin" className="hover:text-pleros-white">Admin ERP</Link>
            <Link to="/catalog" className="hover:text-pleros-white">B2B Shop</Link>
            <Link to="/admin/pos" className="hover:text-pleros-white">POS</Link>
            <Link to="/signup" className="hover:text-pleros-white">Sign up</Link>
            <Link to="/terms" className="hover:text-pleros-white">Terms</Link>
            <Link to="/privacy" className="hover:text-pleros-white">Privacy</Link>
          </div>

          <p className="text-xs text-pleros-text-3">© {new Date().getFullYear()} Pleros Inc. All rights reserved.</p>
        </div>
      </footer>
    </main>
  )
}
